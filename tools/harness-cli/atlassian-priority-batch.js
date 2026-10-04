"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readJson, writeJsonAtomic, withFileLockAsync } = require("./control-plane-state");
const { readConnection } = require("./jira-input");
const { connectionIdentity, matchesConnection, transport } = require("./atlassian-mcp");
const { validateProjectId } = require("./project-registry");
const PRIORITIES = ["Highest", "High", "Medium", "Low", "Lowest"];
const TTL_MS = 10 * 60 * 1000;
const MAX_CHANGES = 20;
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Read an exact project-bound issue set, including all search pages; no result cache. */
async function readIssues(config, keys, send) {
  const seen = new Set(), issues = [], cursors = new Set();
  let cursor;
  for (let page = 0; page < 10; page++) {
    const url = new URL("/rest/api/3/search/jql", config.site);
    url.searchParams.set("jql", `project = ${JSON.stringify(keys[0].split("-")[0])} AND key in (${keys.map(key => JSON.stringify(key)).join(",")}) ORDER BY key`);
    url.searchParams.set("maxResults", "50");
    url.searchParams.set("fields", "project,priority,status,updated");
    if (cursor) url.searchParams.set("nextPageToken", cursor);
    const body = await send(config, "jira", url.pathname + url.search);
    if (!Array.isArray(body.issues)) throw new Error("Invalid priority search response");
    for (const issue of body.issues) {
      if (!keys.includes(issue.key) || seen.has(issue.key) || !/^[0-9]+$/.test(issue.id || "")
          || issue.fields?.project?.key !== keys[0].split("-")[0] || !issue.fields?.priority?.name
          || !issue.fields?.priority?.id || !issue.fields?.status?.id || typeof issue.fields?.updated !== "string" || !issue.fields.updated) {
        throw new Error("Priority search identity/snapshot mismatch");
      }
      seen.add(issue.key);
      issues.push({ key: issue.key, id: issue.id, priority: { id: issue.fields.priority.id, name: issue.fields.priority.name },
        status_id: issue.fields.status.id, updated: issue.fields.updated });
    }
    if (body.isLast === true) {
      if (issues.length !== keys.length) throw new Error("Priority search missing requested issues");
      return keys.map(key => issues.find(issue => issue.key === key));
    }
    cursor = body.nextPageToken;
    if (typeof cursor !== "string" || !cursor || cursor.length > 8192 || cursors.has(cursor)) throw new Error("Priority search pagination incomplete");
    cursors.add(cursor);
  }
  throw new Error("Priority search truncated");
}

/** Exact preview approval, one-time application and read-only uncertain-write recovery. */
function createPriorityBatchCommand({ root, send, now = () => Date.now(), stats = () => ({}) }) {
  const directory = path.join(root, ".harness", "local", "atlassian", "priority-batches");
  const fileFor = id => {
    if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid priority batch id");
    return path.join(directory, id + ".json");
  };
  const requireConfig = () => {
    const config = readConnection(root);
    if (transport(config) !== "mcp") throw new Error("Priority batches require configured MCP; no REST fallback");
    return config;
  };
  const output = batch => ({ id: batch.id, approval_digest: batch.id, status: batch.status, expires_at: batch.plan.expires_at,
    changes: batch.results || batch.plan.changes.map(item => ({ key: item.key, before: item.snapshot.priority.name, target: item.priority })),
    diagnostics: stats() });
  return async (action, subject, options) => {
    const config = requireConfig();
    if (action === "priority-plan") {
      const projectId = validateProjectId(options.project), key = config.jira_projects[projectId];
      if (!/^[A-Z][A-Z0-9_]*$/.test(key || "")) throw new Error("Map the Jira project before priority planning");
      if (typeof options.file !== "string" || !fs.statSync(options.file).isFile() || fs.statSync(options.file).size > 32768) throw new Error("Provide a priority JSON file up to 32KB");
      const input = readJson(options.file, null);
      if (!input || Object.keys(input).join() !== "changes" || !Array.isArray(input.changes) || !input.changes.length || input.changes.length > MAX_CHANGES) throw new Error("Provide 1-20 explicit priority changes");
      const changes = input.changes;
      if (new Set(changes.map(item => item.key)).size !== changes.length || changes.some(item => !item || Object.keys(item).sort().join() !== "key,priority"
          || !new RegExp(`^${key}-[1-9][0-9]*$`).test(item.key) || !PRIORITIES.includes(item.priority))) throw new Error("Priority changes must have unique mapped issue keys and supported priority names");
      const snapshots = await readIssues(config, changes.map(item => item.key), send);
      const plan = { project_id: projectId, connection: connectionIdentity(config), changes: changes.map((item, i) => ({ ...item, snapshot: snapshots[i] })),
        created_at: new Date(now()).toISOString(), expires_at: new Date(now() + TTL_MS).toISOString() };
      const batch = { id: hash(plan), plan, status: "PREPARED" };
      const file = fileFor(batch.id);
      await withFileLockAsync(file, async () => {
        if (fs.existsSync(file)) throw new Error("Priority preview already exists; inspect it rather than overwrite");
        writeJsonAtomic(file, batch);
      });
      return output(batch);
    }
    const file = fileFor(subject);
    return withFileLockAsync(file, async () => {
      const batch = readJson(file, null);
      if (!batch || hash(batch.plan) !== batch.id || batch.id !== subject || !matchesConnection(batch.plan.connection, config)) throw new Error("Priority batch content/connection changed");
      if (action === "priority-show") return output(batch);
      if (action === "priority-reconcile") {
        if (!["APPLYING", "NEEDS_RECONCILIATION", "VERIFIED", "OBSERVED_DESIRED", "PARTIAL"].includes(batch.status)) throw new Error("Reconcile only an attempted priority batch");
        const current = await readIssues(config, batch.plan.changes.map(item => item.key), send);
        batch.results = batch.plan.changes.map((item, i) => ({ ...batch.results?.[i], key: item.key, target: item.priority,
          observed: current[i].priority.name, state: current[i].priority.name === item.priority ? "OBSERVED_DESIRED" : "NOT_AT_TARGET" }));
        batch.status = batch.results.every(item => item.state === "OBSERVED_DESIRED") ? "OBSERVED_DESIRED" : "PARTIAL";
        batch.observed_at = new Date(now()).toISOString();
        writeJsonAtomic(file, batch);
        return output(batch);
      }
      if (action !== "priority-apply") throw new Error("Unknown priority batch command");
      if (batch.status !== "PREPARED" || options.approve !== batch.id) throw new Error("Exact unused priority preview approval required");
      if (!Number.isFinite(Date.parse(batch.plan.expires_at)) || Date.parse(batch.plan.expires_at) <= now()) throw new Error("Priority preview expired; prepare a fresh one");
      const before = await readIssues(config, batch.plan.changes.map(item => item.key), send);
      if (before.some((item, i) => hash(item) !== hash(batch.plan.changes[i].snapshot))) throw new Error("Jira changed after preview; prepare and review a fresh priority plan");
      if (!matchesConnection(batch.plan.connection, readConnection(root))) throw new Error("Priority connection changed during preflight");
      batch.status = "APPLYING";
      batch.approved_at = new Date(now()).toISOString();
      batch.results = batch.plan.changes.map((item, i) => ({ key: item.key, before: before[i].priority.name, target: item.priority,
        state: before[i].priority.name === item.priority ? "UNCHANGED" : "NOT_ATTEMPTED" }));
      writeJsonAtomic(file, batch);
      for (const item of batch.results) {
        if (item.state === "UNCHANGED") continue;
        if (!matchesConnection(batch.plan.connection, readConnection(root))) { batch.status = "NEEDS_RECONCILIATION"; break; }
        item.state = "SUBMITTING";
        writeJsonAtomic(file, batch);
        try {
          await send(config, "jira", `/rest/api/3/issue/${item.key}`, { fields: { priority: { name: item.target } } });
          item.state = "ACKNOWLEDGED";
        } catch {
          item.state = "UNKNOWN";
          batch.status = "NEEDS_RECONCILIATION";
          writeJsonAtomic(file, batch);
          break;
        }
        writeJsonAtomic(file, batch);
      }
      try {
        const after = await readIssues(config, batch.plan.changes.map(item => item.key), send);
        batch.results.forEach((item, i) => {
          item.observed = after[i].priority.name;
          if (["ACKNOWLEDGED", "UNCHANGED"].includes(item.state)) item.state = item.observed === item.target
            && after[i].status_id === before[i].status_id ? "VERIFIED" : "MISMATCH";
        });
        batch.status = batch.results.every(item => item.state === "VERIFIED") ? "VERIFIED" : "NEEDS_RECONCILIATION";
      } catch { batch.status = "NEEDS_RECONCILIATION"; }
      batch.finished_at = new Date(now()).toISOString();
      writeJsonAtomic(file, batch);
      const result = output(batch);
      if (batch.status !== "VERIFIED") throw new Error(`Priority batch incomplete (${batch.id}); inspect priority-show, then read-only priority-reconcile; never resend this batch`);
      return result;
    }, { ttlMs: 10 * 60 * 1000 });
  };
}
module.exports = { createPriorityBatchCommand, readIssues };
