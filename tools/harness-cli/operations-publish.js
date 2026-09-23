"use strict";

const path = require("node:path");
const { readJson } = require("./control-plane-state");
const { requireConsent } = require("./atlassian-consent");
const { validateProjectId } = require("./project-registry");

/** A bounded delivery pass. Delivery failure never retries implementation or an uncertain POST. */
async function publishFollowups({ root, env, atlassian, operations }, options) {
  if (!options.request && !options.project) throw new Error("Use operations flush --request ID or --project ID");
  if (options.request) validateProjectId(options.request);
  if (options.project) validateProjectId(options.project);
  const result = { recorded: 0, deferred: [], skipped: 0 };
  if (["true", "1"].includes(env.HARNESS_OFFLINE)) return { ...result, offline: true };
  const plan = options.request ? readJson(path.join(root, ".harness/local/requests", `${options.request}.json`), null) : null;
  if (options.request && !plan) throw new Error("Unknown request for publication");
  const outbox = () => readJson(path.join(root, ".harness/local/atlassian/outbox.json"), { entries: [] }).entries;
  let processed = 0;
  const attempt = async (id, project, action) => {
    if (options.project && options.project !== project) return;
    if (processed >= 20) { result.deferred.push({ id, reason: "Batch limit reached; run operations flush again" }); return; }
    let grant;
    try { grant = requireConsent(root, project, env); }
    catch {
      result.skipped++;
      if (readJson(path.join(root, ".harness/local/atlassian/consents.json"), { grants: [] }).grants.some(g => g.scope.project_id === project)) {
        result.deferred.push({ id, reason: "Standing consent unavailable, revoked or changed; review consent status and scope" });
      }
      return;
    }
    processed++;
    try { await action(grant); result.recorded++; }
    catch { result.deferred.push({ id, reason: "Not recorded; inspect operations audit / atlassian status. No automatic retry of rejected or uncertain writes." }); }
  };
  const sync = async (entry, grant) => {
    if (entry.operation === "transition" && outbox().some(e => e.id !== entry.id && e.transition?.issue_id === entry.transition.issue_id
        && ["SENDING", "NEEDS_RECONCILIATION"].includes(e.status))) throw new Error("Reconcile previous status delivery before sending a newer state");
    if (entry.status === "PENDING") await atlassian(["sync", "--project", entry.project_id, "--entry", entry.id, "--consent", grant.id]);
    else if (entry.status !== "SYNCED") throw new Error("Existing publication requires inspection");
  };
  // Only the explicitly addressed request may publish new tickets, never every old draft.
  if (plan?.status === "DRAFT") for (const ticket of plan.tickets.filter(t => !t.source)) {
    await attempt(`${plan.request_id}:${ticket.ticket_id}`, ticket.project_id, async grant => {
      const entry = await atlassian(["queue-ticket", plan.request_id, "--ticket", ticket.ticket_id]);
      await sync(entry, grant);
      requireConsent(root, ticket.project_id, env, grant.id);
      await atlassian(["link", plan.request_id, "--ticket", ticket.ticket_id]);
    });
  }
  const intents = await operations(["audit", ...(options.project ? ["--project", options.project] : [])]);
  for (const intent of intents.filter(e => !options.request || e.fact.request_id === options.request)) {
    if (intent.publication_status === "SYNCED") continue;
    await attempt(intent.id, intent.fact.project_id, async grant => {
      // Prepare never retries existing REJECTED / SENDING / NEEDS_RECONCILIATION entries.
      const entry = await operations(["prepare", intent.id]);
      await sync(outbox().find(e => e.id === entry.id) || entry, grant);
    });
  }
  return result;
}

/** Only state-changing managed commands trigger delivery, never list/search/help. */
function createPublicationHook({ parseArgs, flush, log }) {
  const actions = { request: ["create", "revise", "priority", "approve"], execution: ["prepare", "advance", "review-ready"], runner: ["run"], history: ["review"] };
  return async (command, args) => {
    const { positional: [action, subject], options } = parseArgs(args);
    if (!actions[command]?.includes(action)) return;
    const request = command === "history" ? options.request : subject;
    if (!request) return;
    try {
      const result = await flush(["flush", "--request", request]);
      if (result.recorded) log(`[INFO] Recorded ${result.recorded} managed publications under standing consent.`);
      if (result.deferred.length) log(`[WARN] ${result.deferred.length} publications pending inspection; use operations audit and atlassian status. Development outcome unchanged.`);
    } catch { log("[WARN] Follow-up delivery pending; inspect operations audit. Development outcome unchanged."); }
  };
}

module.exports = { publishFollowups, createPublicationHook };
