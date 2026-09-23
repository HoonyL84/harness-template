"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { readJson, updateJsonLocked } = require("./control-plane-state");
const { readConnection } = require("./jira-input");
const { validateProjectId } = require("./project-registry");
const { readIntent, assertFollowup, summaryInput } = require("./operations-followup");
const { ticketDraft, resultPayload } = require("./atlassian-payloads");
const { connectionIdentity } = require("./atlassian-mcp");

const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const file = root => path.join(root, ".harness/local/atlassian/consents.json");
const empty = () => ({ grants: [] });

function scopeFor(root, project, env) {
  validateProjectId(project);
  const config = readConnection(root);
  if (!env.ATLASSIAN_EMAIL || !env.ATLASSIAN_API_TOKEN) throw new Error("Configure Atlassian credentials before granting consent");
  if (!config.jira_projects?.[project] || !config.jira_issue_types?.[project]
      || !config.confluence_projects?.[project]?.parent_id || !config.confluence_projects?.[project]?.space_id
      || !config.workflow_statuses?.[project]) throw new Error("Map Jira, Confluence and workflow before granting consent");
  return { version: 2, project_id: project, ...connectionIdentity(config),
    principal_hash: hash(env.ATLASSIAN_EMAIL.trim().toLowerCase()), jira_project: config.jira_projects[project],
    issue_type: config.jira_issue_types[project], priority_map: config.priority_map || {},
    confluence: config.confluence_projects[project], workflow: config.workflow_statuses[project],
    operations: ["managed-ticket-create", "managed-status", "managed-result-page-create"],
    excluded: ["Git", "execution-approval", "human-review", "page-overwrite", "delete", "arbitrary-payload", "raw-logs"] };
}

/** Local consent only authorizes the exact mapped scope, never execution or Git release. */
function consentCommand(root, action, options, env, now = Date.now) {
  const project = validateProjectId(options.project);
  if (action === "revoke") return updateJsonLocked(file(root), empty(), state => {
    for (const grant of state.grants.filter(g => g.scope.project_id === project && !g.revoked_at)) grant.revoked_at = new Date(now()).toISOString();
    return state;
  });
  if (action === "status") return readJson(file(root), empty()).grants.filter(g => g.scope.project_id === project);
  const scope = scopeFor(root, project, env), digest = hash(scope);
  if (action === "preview") return { scope, approval_digest: digest, notice: "One-time consent permits future managed ticket text, status and result summaries (including annotations) in this scope. No Git or execution approval." };
  if (action !== "grant" || options.approve !== digest) throw new Error("Review consent preview then grant --approve <scope-digest>");
  return updateJsonLocked(file(root), empty(), state => {
    if (hash(scopeFor(root, project, env)) !== digest) throw new Error("Scope changed during approval");
    for (const grant of state.grants.filter(g => g.scope.project_id === project && !g.revoked_at)) grant.revoked_at = new Date(now()).toISOString();
    state.grants.push({ id: crypto.randomUUID(), scope, scope_digest: digest, granted_at: new Date(now()).toISOString() });
    return state;
  }).grants.at(-1);
}

function requireConsent(root, project, env, expectedId) {
  const scope = scopeFor(root, project, env);
  const grant = readJson(file(root), empty()).grants.findLast(g => g.scope.project_id === project && !g.revoked_at);
  if (!grant || grant.scope_digest !== hash(scope) || hash(grant.scope) !== grant.scope_digest || (expectedId && expectedId !== grant.id)) throw new Error("Standing consent missing, revoked or stale; review scope again");
  return grant;
}

/** Validate actual payloads, not just the outbox's claimed operation type. */
function assertConsentedEntry(root, entry, env, reviewFingerprint, grantId) {
  const grant = requireConsent(root, entry.project_id, env, grantId), config = readConnection(root);
  if (hash(entry.connection) !== hash(connectionIdentity(config))) throw new Error("Consent destination mismatch");
  if (entry.service === "jira" && entry.operation === "create") {
    validateProjectId(entry.request_id); validateProjectId(entry.ticket_id);
    const plan = readJson(path.join(root, ".harness/local/requests", `${entry.request_id}.json`), null);
    const ticket = plan?.tickets?.find(t => t.ticket_id === entry.ticket_id);
    if (ticket?.project_id !== entry.project_id || hash(ticket) !== entry.ticket_snapshot) throw new Error("Consented ticket changed since preparation");
    if (hash(ticketDraft(config, plan, ticket, entry.request_id).build(entry.marker)) !== hash(entry.payload)) throw new Error("Noncanonical ticket payload");
  } else {
    if (!entry.followup) throw new Error("Standing consent excludes arbitrary publications");
    assertFollowup(root, entry.followup, config, reviewFingerprint);
    const intent = readIntent(root, entry.followup.id);
    if (intent.fact.project_id !== entry.project_id) throw new Error("Follow-up project mismatch");
    if (entry.service === "confluence" && entry.operation === "create" && intent.kind === "confluence-result") {
      if (hash(resultPayload(config.confluence_projects[entry.project_id], summaryInput(intent), entry.marker)) !== hash(entry.payload)) throw new Error("Noncanonical result payload");
    } else if (entry.service === "jira" && entry.operation === "transition" && intent.kind === "jira-status") {
      const tr = entry.transition;
      if (tr.issue_key !== intent.fact.source?.issue_key || tr.issue_id !== intent.fact.source?.issue_id
          || tr.project_key !== config.jira_projects[entry.project_id] || tr.to_status !== config.workflow_statuses[entry.project_id][intent.fact.status]
          || !/^[0-9]+$/.test(entry.payload?.transition?.id || "")
          || hash(entry.payload) !== hash({ transition: { id: entry.payload.transition.id } })) throw new Error("Noncanonical status payload");
    } else throw new Error("Operation not permitted by standing consent");
  }
  return grant;
}

module.exports = { consentCommand, requireConsent, assertConsentedEntry };
