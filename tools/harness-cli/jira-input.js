"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { readJson } = require("./control-plane-state");
const { transport, createMcpClient } = require("./atlassian-mcp");

const MAX_RESPONSE_BYTES = 256 * 1024;
const ISSUE_KEY = /^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/;

function siteOrigin(value) {
  if (typeof value !== "string" || !/^https:\/\/[a-z0-9-]+\.atlassian\.net\/?$/.test(value)) {
    throw new Error("Atlassian site must be an HTTPS tenant origin: https://your-site.atlassian.net");
  }
  return new URL(value).origin;
}

/** Keep only source identity/evidence, never credentials or arbitrary remote URLs. */
function normalizeJiraSource(source) {
  if (!source || source.kind !== "jira" || !/^[0-9]+$/.test(source.issue_id)
      || !ISSUE_KEY.test(source.issue_key) || !/^[A-Z][A-Z0-9_]*$/.test(source.project_key)
      || !/^[a-f0-9]{64}$/.test(source.input_fingerprint)) throw new Error("Invalid Jira source snapshot");
  return {
    kind: "jira", site: siteOrigin(source.site), issue_id: source.issue_id,
    issue_key: source.issue_key, project_key: source.project_key,
    input_fingerprint: source.input_fingerprint, updated: String(source.updated || "")
  };
}

function readConnection(root) {
  const config = readJson(path.join(root, ".harness", "local", "atlassian.json"), null);
  if (!config) throw new Error("Configure .harness/local/atlassian.json before using Jira");
  return validateConnection(config);
}

function validateConnection(config) {
  transport(config);
  const site = siteOrigin(config.site);
  if (config.cloud_id && !/^[a-f0-9-]{36}$/i.test(config.cloud_id)) throw new Error("Invalid Atlassian cloud_id");
  if (!config.jira_projects || typeof config.jira_projects !== "object" || Array.isArray(config.jira_projects)) {
    throw new Error("Atlassian jira_projects mapping is required");
  }
  return { ...config, site };
}

function descriptionText(node, depth = 0) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (depth > 40) throw new Error("Jira description nesting exceeds the supported limit");
  const text = typeof node.text === "string" ? node.text : "";
  const children = Array.isArray(node.content) ? node.content.map((child) => descriptionText(child, depth + 1)).join("") : "";
  return text + children + (["paragraph", "heading", "listItem", "hardBreak"].includes(node.type) ? "\n" : "");
}

async function readBoundedJson(response) {
  let bytes = 0;
  const chunks = [];
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES) {
    await response.body?.cancel();
    throw new Error("Jira response exceeds 256KB");
  }
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) throw new Error("Jira response exceeds 256KB");
    chunks.push(Buffer.from(chunk));
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {
    throw new Error("Jira returned invalid JSON");
  }
}

/** Read a single issue with fixed endpoints, no redirects, and no secret-bearing error output. */
async function getIssue(config, issue, { env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!ISSUE_KEY.test(issue) && !/^[0-9]+$/.test(issue)) throw new Error("Invalid Jira issue id or key");
  if (transport(config) === "mcp") return createMcpClient({ env, fetchImpl }).send(config, "jira", `/rest/api/3/issue/${issue}?fields=summary,description,priority,project,updated`);
  if (["true", "1"].includes(env.HARNESS_OFFLINE)) throw new Error("Jira is unavailable in HARNESS_OFFLINE mode");
  const email = env.ATLASSIAN_EMAIL;
  const token = env.ATLASSIAN_API_TOKEN;
  if (!email || !token || /replace|your_|example|\.\.\./i.test(token)) throw new Error("Set ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN locally");
  const base = config.cloud_id ? `https://api.atlassian.com/ex/jira/${config.cloud_id}` : config.site;
  let response;
  try {
    response = await fetchImpl(`${base}/rest/api/3/issue/${encodeURIComponent(issue)}?fields=summary,description,priority,project,updated`, {
      method: "GET", redirect: "error", signal: globalThis.AbortSignal.timeout(15_000),
      headers: { Accept: "application/json", Authorization: `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}` }
    });
  } catch {
    throw new Error("Jira read failed (network, timeout or redirect); check the local connection settings");
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(new Error(`Jira read failed (HTTP ${response.status}); check permissions or retry later`), { status: response.status, noRetry: true });
  }
  return readBoundedJson(response);
}

function snapshot(config, issue, projectKey) {
  if (issue.fields?.project?.key !== projectKey || !ISSUE_KEY.test(issue.key) || !/^[0-9]+$/.test(issue.id)
      || typeof issue.fields.summary !== "string" || !issue.fields.summary.trim()) throw new Error("Jira issue does not match the configured project or response schema");
  const input = {
    summary: issue.fields.summary, description: issue.fields.description ?? null,
    priority_id: issue.fields.priority?.id ?? null, project_key: projectKey
  };
  const inputFingerprint = crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return normalizeJiraSource({ kind: "jira", site: config.site, issue_id: issue.id, issue_key: issue.key,
    project_key: projectKey, updated: issue.fields.updated, input_fingerprint: inputFingerprint });
}

/** Import is read-only and produces DRAFT inputs, not an execution approval. */
async function readJiraTickets(root, projectId, keys, options = {}) {
  const config = readConnection(root);
  const projectKey = config.jira_projects[projectId];
  if (!/^[A-Z][A-Z0-9_]*$/.test(projectKey || "")) throw new Error(`No valid Jira project mapping for ${projectId}`);
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 20 || new Set(keys).size !== keys.length
      || keys.some((key) => !ISSUE_KEY.test(key) || !key.startsWith(`${projectKey}-`))) {
    throw new Error("Provide 1-20 unique issue keys from the mapped Jira project");
  }
  const tickets = [];
  for (const key of keys) {
    const issue = await getIssue(config, key, options);
    if (issue.key !== key) throw new Error("Jira returned a different issue key; check the current key before importing");
    const source = snapshot(config, issue, projectKey);
    const priority = config.priority_map?.[issue.fields.priority?.id];
    if (!["P0", "P1", "P2", "P3"].includes(priority)) throw new Error("Map the Jira priority id to P0/P1/P2/P3 in atlassian.json priority_map");
    tickets.push({
      ticket_id: `jira-${issue.id}`, project_id: projectId, goal: issue.fields.summary, priority,
      context_summary: descriptionText(issue.fields.description).trim(), source,
      planning_status: "NEEDS_PLAN"
    });
  }
  return tickets;
}

/** Fail closed on stale source inputs; unrelated comments/status changes do not grant approval. */
function requirePublishedDraftImported(root, plan) {
  const outbox = readJson(path.join(root, ".harness", "local", "atlassian", "outbox.json"), { entries: [] });
  if (outbox.entries.some(entry => entry.service === "jira" && entry.request_id === plan.request_id
      && plan.tickets.some(ticket => ticket.ticket_id === entry.ticket_id && !ticket.source))) {
    throw new Error("This draft is queued for Jira publication. Sync/reconcile and atlassian link it before approval, or import a changed Jira issue into a new reviewed request");
  }
}

async function requireJiraFresh(root, plan, options = {}) {
  requirePublishedDraftImported(root, plan);
  const tickets = plan.tickets.filter((ticket) => ticket.source?.kind === "jira");
  if (!tickets.length) return;
  try {
    const config = readConnection(root);
    for (const ticket of tickets) {
      const source = normalizeJiraSource(ticket.source);
      if (source.site !== config.site || config.jira_projects[ticket.project_id] !== source.project_key) {
        throw new Error(`Jira connection mapping changed: ${ticket.ticket_id}`);
      }
      const issue = await getIssue(config, source.issue_id, options);
      const current = snapshot(config, issue, source.project_key);
      if (current.issue_id !== source.issue_id || current.input_fingerprint !== source.input_fingerprint) {
        throw new Error(`Jira inputs changed: ${source.issue_key}; import a new draft and review it before execution`);
      }
    }
  } catch (error) {
    error.noRetry = true;
    throw error;
  }
}

module.exports = { normalizeJiraSource, snapshot, readJiraTickets, requireJiraFresh, requirePublishedDraftImported, readConnection, validateConnection, readBoundedJson };
