"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJson, updateJsonLocked } = require("./control-plane-state");
const { readJsonDirectory } = require("./control-plane-state");
const { readRegistry } = require("./project-registry");

const STATUSES = new Set(["SUCCEEDED", "FAILED", "ROLLED_BACK"]);
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

function normalizeStringList(value, label) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
}

function normalizeDeployment(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Deployment record must be an object");
  const deploymentId = String(item.deployment_id || "").trim();
  if (!ID_PATTERN.test(deploymentId)) throw new Error("Deployment id must contain only lowercase letters, numbers, dot, underscore, or hyphen");
  const status = String(item.status || "").trim().toUpperCase();
  if (!STATUSES.has(status)) throw new Error("Deployment status must be SUCCEEDED, FAILED, or ROLLED_BACK");
  const deployedAt = String(item.deployed_at || "").trim();
  if (!deployedAt || Number.isNaN(Date.parse(deployedAt))) throw new Error("Deployment deployed_at must be an ISO date");
  const record = {
    schema_version: "1.0",
    deployment_id: deploymentId,
    project_id: String(item.project_id || "").trim(),
    environment: String(item.environment || "").trim(),
    status,
    source_branch: String(item.source_branch || "").trim(),
    source_commit: String(item.source_commit || "").trim(),
    ticket_ids: normalizeStringList(item.ticket_ids, "Deployment ticket_ids"),
    request_id: item.request_id ? String(item.request_id).trim() : null,
    deployed_at: new Date(deployedAt).toISOString(),
    tag: item.tag ? String(item.tag).trim() : null,
    ci_url: item.ci_url ? String(item.ci_url).trim() : null,
    rollback_of: item.rollback_of ? String(item.rollback_of).trim() : null,
    notes: item.notes ? String(item.notes).trim() : null
  };
  if (!record.project_id || !record.environment || !record.source_branch) throw new Error("Deployment requires project_id, environment, and source_branch");
  if (!/^[0-9a-f]{7,40}$/i.test(record.source_commit)) throw new Error("Deployment source_commit must be a 7-40 character Git SHA");
  if (record.status === "ROLLED_BACK" && !record.rollback_of) throw new Error("ROLLED_BACK deployment requires rollback_of");
  if (record.ci_url) {
    let url;
    try { url = new URL(record.ci_url); } catch { throw new Error("Deployment ci_url must be a valid HTTPS URL"); }
    if (url.protocol !== "https:") throw new Error("Deployment ci_url must be a valid HTTPS URL");
  }
  return record;
}

function requireGitCommit(runGit, projectPath, commit) {
  const result = runGit(["cat-file", "-e", `${commit}^{commit}`], projectPath);
  if (result.error || result.status !== 0) throw new Error(`Deployment commit does not exist in project: ${commit}`);
}

function verifySourceReference(runGit, projectPath, record) {
  const branchFormat = runGit(["check-ref-format", "--branch", record.source_branch], projectPath);
  if (branchFormat.error || branchFormat.status !== 0) throw new Error(`Deployment source_branch is not a valid Git branch: ${record.source_branch}`);
  const candidates = [`refs/heads/${record.source_branch}`, `refs/remotes/origin/${record.source_branch}`];
  const resolved = candidates.find((ref) => {
    const result = runGit(["rev-parse", "--verify", ref], projectPath);
    return !result.error && result.status === 0;
  });
  if (resolved) {
    const ancestor = runGit(["merge-base", "--is-ancestor", record.source_commit, resolved], projectPath);
    if (ancestor.error || ancestor.status !== 0) throw new Error(`Deployment commit is not contained in source branch: ${record.source_branch}`);
  }
  if (record.tag) {
    const tagFormat = runGit(["check-ref-format", `refs/tags/${record.tag}`], projectPath);
    const tag = runGit(["rev-parse", `refs/tags/${record.tag}^{commit}`], projectPath);
    const source = runGit(["rev-parse", `${record.source_commit}^{commit}`], projectPath);
    if (tagFormat.error || tagFormat.status !== 0 || tag.error || tag.status !== 0 || source.error || source.status !== 0 || String(tag.stdout || "").trim() !== String(source.stdout || "").trim()) {
      throw new Error(`Deployment tag does not resolve to source_commit: ${record.tag}`);
    }
  }
  return resolved || null;
}

function createDeploymentCommand({ root, parseArgs, runGit, log }) {
  const ledgerPath = path.join(root, "observability", "deployments", "ledger.json");
  const local = path.join(root, ".harness", "local");
  return function commandDeployment(args) {
    const { positional, options } = parseArgs(args);
    const [action, rawId] = positional;
    const ledger = readJson(ledgerPath, []);
    if (action === "record") {
      if (!options.file || options.file === true) throw new Error("deployment record requires --file <json>");
      const record = normalizeDeployment(JSON.parse(fs.readFileSync(path.resolve(options.file), "utf8")));
      const registry = readRegistry(path.join(local, "projects.json"));
      const project = registry.projects[record.project_id];
      if (!project) throw new Error(`Deployment project is not registered: ${record.project_id}`);
      requireGitCommit(runGit, project.path, record.source_commit);
      const verifiedRef = verifySourceReference(runGit, project.path, record);
      if (record.ticket_ids.length > 0) {
        const executions = readJsonDirectory(path.join(local, "executions"));
        for (const ticketId of record.ticket_ids) {
          if (!executions.some((execution) => execution.tickets?.some((ticket) => ticket.ticket_id === ticketId && ticket.project_id === record.project_id))) {
            throw new Error(`Deployment ticket is not recorded for project: ${ticketId}`);
          }
        }
        if (record.request_id && !executions.some((execution) => execution.request_id === record.request_id && record.ticket_ids.every((ticketId) => execution.tickets?.some((ticket) => ticket.ticket_id === ticketId && ticket.project_id === record.project_id)))) {
          throw new Error(`Deployment tickets do not belong to request: ${record.request_id}`);
        }
      }
      const updated = updateJsonLocked(ledgerPath, [], (current) => {
        if (current.some((item) => item.deployment_id === record.deployment_id)) throw new Error(`Deployment id already exists: ${record.deployment_id}`);
        if (record.rollback_of && !current.some((item) => item.deployment_id === record.rollback_of)) throw new Error(`Unknown rollback deployment: ${record.rollback_of}`);
        return [...current, { ...record, source_ref_verified: verifiedRef, recorded_at: new Date().toISOString() }];
      });
      log(`[DEPLOYMENT_RECORDED] ${record.deployment_id}`);
      return updated.at(-1);
    }
    if (action === "show") {
      const id = String(rawId || "").trim().toLowerCase();
      const found = ledger.find((item) => item.deployment_id === id);
      if (!found) throw new Error(`Unknown deployment: ${id}`);
      log(JSON.stringify(found, null, 2));
      return found;
    }
    if (action === "list") {
      const filtered = ledger.filter((item) => (!options.project || item.project_id === options.project)
        && (!options.environment || item.environment === options.environment)
        && (!options.status || item.status === String(options.status).toUpperCase()));
      log(JSON.stringify(filtered, null, 2));
      return filtered;
    }
    throw new Error("Usage: deployment <record|list|show> [id] [--file <json>] [--project <id>] [--environment <name>] [--status <status>]");
  };
}

module.exports = { createDeploymentCommand, normalizeDeployment, requireGitCommit, verifySourceReference };
