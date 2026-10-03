"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readJson, readJsonDirectory, updateJsonLocked, writeJsonAtomic } = require("./control-plane-state");
const { connectionIdentity } = require("./atlassian-mcp");
const { assertArtifactEvidence, isArtifactTicket } = require("./ticket-artifacts");
const { assertExecutionMatchesPlan } = require("./project-execution");
const { validateRequestPlan } = require("./request-plan");

const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const store = root => path.join(root, ".harness/local/followups.json");
const empty = () => ({ entries: [] });
const eligible = new Set(["RUNNING", "VERIFYING", "BLOCKED", "REVIEW_READY"]);

/** Derive publication facts from evidence, not from a claim in an AI response. */
function currentFacts(root) {
  const reviews = readJson(path.join(root, ".harness/local/history/ledger.json"), { events: [] }).events;
  const facts = [];
  for (const state of readJsonDirectory(path.join(root, ".harness/local/executions"))) {
    for (const ticket of state?.tickets || []) {
      if (!eligible.has(ticket.status)) continue;
      const review = [...reviews].reverse().find(e => e.kind === "USER_REVIEW" && e.request_id === state.request_id
        && e.ticket_id === ticket.ticket_id && e.project_id === ticket.project_id && e.fingerprint === ticket.verification?.content_fingerprint);
      const status = ticket.status === "REVIEW_READY" && review
        ? review.status === "accepted" ? "COMPLETED" : "CHANGES_REQUESTED" : ticket.status;
      facts.push({ request_id: state.request_id, ticket_id: ticket.ticket_id, project_id: ticket.project_id, goal: ticket.goal,
        status, attempts: ticket.runner?.attempts || 0, source: ticket.source || null, worktree: ticket.worktree, ticket_kind: ticket.ticket_kind || "development",
        verification: ticket.verification ? { fingerprint: ticket.verification.content_fingerprint,
          ...(ticket.verification.mode === "artifact" ? { mode: "artifact", artifacts: ticket.verification.artifacts, acceptance_checklist: ticket.verification.acceptance_checklist } : {}),
          results: (ticket.verification.results || []).map(r => ({ command: r.command, status: r.status })) } : null,
        review_id: review?.event_id || null });
    }
  }
  return facts;
}

/** Safe to repeat after a crash. No network or model calls; publication always needs approval. */
function captureFollowups(root) {
  if (!fs.existsSync(path.join(root, ".harness/local/atlassian.json"))) return empty();
  const facts = currentFacts(root), wanted = new Map();
  for (const fact of facts) {
    for (const kind of ["jira-status", ...(["RUNNING", "VERIFYING"].includes(fact.status) ? [] : ["confluence-result"])]) {
      const id = hash([kind, fact]);
      wanted.set(id, { id, kind, fact, evidence_hash: hash(fact), status: "DRAFT", created_at: new Date().toISOString() });
    }
  }
  return updateJsonLocked(store(root), empty(), state => {
    for (const entry of state.entries) {
      if (!wanted.has(entry.id)) entry.status = "SUPERSEDED";
      else if (entry.status === "SUPERSEDED") entry.status = "DRAFT";
    }
    for (const [id, entry] of wanted) if (!state.entries.some(e => e.id === id)) state.entries.push(entry);
    return state;
  });
}

function safeCaptureFollowups(root, log) {
  try { return captureFollowups(root); }
  catch { log("[WARN] Follow-up capture pending; use operations repair after inspecting local state. Development outcome was not changed."); }
}

function readIntent(root, id) {
  if (!/^[a-f0-9]{64}$/.test(id || "")) throw new Error("Use a follow-up id from operations audit");
  const entry = readJson(store(root), empty()).entries.find(e => e.id === id);
  if (!entry || entry.status === "SUPERSEDED") throw new Error("Follow-up is missing or superseded; run operations repair");
  const fact = currentFacts(root).find(f => f.request_id === entry.fact.request_id && f.ticket_id === entry.fact.ticket_id && f.project_id === entry.fact.project_id);
  if (!fact || hash(fact) !== entry.evidence_hash) throw new Error("Follow-up evidence changed; repair and review a new draft");
  return entry;
}

function bindFollowup(root, id, config) {
  const entry = readIntent(root, id), project = entry.fact.project_id;
  const destination = entry.kind === "jira-status"
    ? { ...connectionIdentity(config), project: config.jira_projects?.[project], workflow: config.workflow_statuses?.[project] }
    : { ...connectionIdentity(config), destination: config.confluence_projects?.[project] };
  return { id, evidence_hash: entry.evidence_hash, annotation_hash: hash(entry.annotation || null), destination_hash: hash(destination) };
}

function assertFollowup(root, binding, config, reviewFingerprint) {
  if (!binding) return;
  const entry = readIntent(root, binding.id);
  if (hash(bindFollowup(root, binding.id, config)) !== hash(binding)) throw new Error("Follow-up destination or draft changed; prepare and approve again");
  const state = readJson(path.join(root, ".harness/local/executions", `${entry.fact.request_id}.json`), null);
  const plan = readJson(path.join(root, ".harness/local/requests", `${entry.fact.request_id}.json`), null);
  if (state && plan) assertExecutionMatchesPlan(state, validateRequestPlan(plan), root);
  const ticket = state?.tickets?.find(t => t.ticket_id === entry.fact.ticket_id && t.project_id === entry.fact.project_id);
  if (ticket && isArtifactTicket(ticket) && ticket.verification) assertArtifactEvidence(ticket);
  if (entry.fact.verification && (!reviewFingerprint || reviewFingerprint(entry.fact.worktree) !== entry.fact.verification.fingerprint)) {
    throw new Error("Follow-up verified files changed; reverify before publication");
  }
}

function summaryInput(entry) {
  const f = entry.fact;
  const checks = f.verification?.results || [];
  const verification = f.verification?.mode === "artifact" ? `artifact structure checked; ${checks.length} optional checks, ${checks.filter(r => r.status === 0).length} passed` : f.verification ? `${checks.length} checks, ${checks.filter(r => r.status === 0).length} passed` : "not passed";
  const lines = [`Status: ${f.status}`, `Attempts: ${f.attempts}`, `Verification: ${verification}`,
    `Evidence fingerprint: ${f.verification?.fingerprint || "none"}`, `Human review: ${f.review_id ? f.status : "pending"}`,
    "Completion here means human acceptance, NOT Git commit, push or deployment."];
  if (f.verification?.mode === "artifact") lines.push(`Ticket kind: ${f.ticket_kind}`, "Artifact checks validate structure only; criteria require human acceptance.", ...f.verification.artifacts.map(a => `Artifact: ${a.path} (SHA-256: ${a.sha256})\n${a.content}`));
  if (entry.annotation) lines.push("Reviewed agent/user explanation:", JSON.stringify(entry.annotation, null, 2));
  return { request_id: f.request_id, ticket_id: f.ticket_id, title: `${f.status}: ${f.goal || f.ticket_id}`.slice(0, 180), summary: lines.join("\n") };
}

function createFollowupCommand({ root, parseArgs, log, atlassian, reviewFingerprint, env = process.env }) {
  const print = result => { log(JSON.stringify(result, null, 2)); return result; };
  return async function command(args) {
    const { positional: [action, id], options } = parseArgs(args);
    if (action === "flush") return print(await require("./operations-publish").publishFollowups({ root, env, atlassian, operations: command }, options));
    if (["audit", "repair"].includes(action)) {
      const state = captureFollowups(root);
      const outbox = readJson(path.join(root, ".harness/local/atlassian/outbox.json"), { entries: [] });
      return print(state.entries.filter(e => e.status !== "SUPERSEDED" && (!options.project || e.fact.project_id === options.project)).map(entry => {
        const publications = outbox.entries.filter(p => p.followup?.id === entry.id);
        const publication = publications.filter(p => p.status !== "SUPERSEDED").at(-1);
        return { ...entry, publication_status: publication?.status || "MISSING", outbox_id: publication?.id || null,
          next: publication ? publication.status === "PENDING" ? "atlassian preview then approved sync"
            : publication.status === "SYNCED" ? "recorded" : "inspect outbox; reconcile uncertain writes or explicitly retry rejected delivery" : "operations prepare <id>" };
      }));
    }
    const entry = readIntent(root, id);
    if (action === "annotate") {
      if (entry.kind !== "confluence-result" || typeof options.file !== "string" || fs.statSync(options.file).size > 16000) throw new Error("Annotate a result intent using --file JSON up to 16KB");
      const annotation = readJson(options.file, null), keys = ["before", "after", "rationale", "context_changes"];
      if (!annotation || Array.isArray(annotation) || Object.keys(annotation).length === 0 || Object.keys(annotation).some(k => !keys.includes(k) || typeof annotation[k] !== "string")) throw new Error("Use only before/after/rationale/context_changes strings");
      const pending = readJson(path.join(root, ".harness/local/atlassian/outbox.json"), { entries: [] }).entries.some(e => e.followup?.id === id);
      if (pending) throw new Error("Already prepared; do not rewrite an approved publication draft");
      updateJsonLocked(store(root), empty(), state => { state.entries.find(e => e.id === id).annotation = annotation; return state; });
      return print(readIntent(root, id));
    }
    if (action !== "prepare") throw new Error("Usage: operations <audit|repair|prepare id|annotate id --file JSON> [--project id]");
    const config = require("./jira-input").readConnection(root);
    assertFollowup(root, bindFollowup(root, id, config), config, reviewFingerprint);
    const existing = readJson(path.join(root, ".harness/local/atlassian/outbox.json"), { entries: [] }).entries.find(e => e.followup?.id === id && e.status !== "SUPERSEDED");
    if (existing) return print(existing);
    if (entry.kind === "jira-status") {
      const status = config.workflow_statuses?.[entry.fact.project_id]?.[entry.fact.status];
      if (!status || !entry.fact.source?.issue_key) throw new Error("Map workflow statuses and link the Jira ticket before preparing status publication");
      return atlassian(["queue-status", "--project", entry.fact.project_id, "--issue", entry.fact.source.issue_key, "--status-id", status, "--followup", id]);
    }
    const file = path.join(root, ".harness/local/followup-drafts", `${id}.json`);
    writeJsonAtomic(file, summaryInput(entry));
    return atlassian(["queue-result", "--project", entry.fact.project_id, "--file", file, "--followup", id]);
  };
}

module.exports = { captureFollowups, safeCaptureFollowups, readIntent, bindFollowup, assertFollowup, summaryInput, createFollowupCommand };
