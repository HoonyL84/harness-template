"use strict";

const crypto = require("node:crypto");
const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const RELEASE_OPERATIONS = new Set(["record", "commit", "push", "merge"]);

function normalizeReleaseSpec(spec = {}) {
  const operation = String(spec.operation || "record").toLowerCase();
  if (!RELEASE_OPERATIONS.has(operation)) throw new Error("Release operation must be record, commit, push, or merge");
  const message = String(spec.message || "").trim();
  const remote = String(spec.remote || "origin").trim();
  const target_branch = String(spec.targetBranch || "").trim();
  if (operation === "commit" && !message) throw new Error("Managed commit requires a release message");
  if (operation === "push" && !remote) throw new Error("Managed push requires a remote");
  if (operation === "merge" && (!message || !target_branch)) throw new Error("Managed merge requires a message and target branch");
  return { operation, message: message || null, remote: operation === "push" ? remote : null, target_branch: operation === "merge" ? target_branch : null };
}

function createReleaseApproval(execution, summary, spec) {
  const requestedIds = Array.isArray(spec?.ticketIds) ? [...new Set(spec.ticketIds.map(String))] : [];
  if (requestedIds.length === 0 && execution.status !== "REVIEW_READY") {
    throw new Error("Execution must be REVIEW_READY before a full release approval");
  }
  const selected = requestedIds.length === 0
    ? execution.tickets
    : requestedIds.map((ticketId) => {
      const ticket = execution.tickets.find((item) => item.ticket_id === ticketId);
      if (!ticket) throw new Error(`Unknown release ticket: ${ticketId}`);
      return ticket;
    });
  if (selected.some((ticket) => ticket.status !== "REVIEW_READY")) {
    throw new Error("Every selected release ticket must be REVIEW_READY");
  }
  const payload = { approval_id: String(spec?.approvalId || execution.request_id), execution_id: execution.execution_id, request_id: execution.request_id, summary: String(summary || "").trim(), release: normalizeReleaseSpec(spec), tickets: selected.map(({ ticket_id, project_id, branch, worktree, base_commit, review_fingerprint, verification }) => ({ ticket_id, project_id, branch, worktree, base_commit, review_fingerprint, verification })) };
  if (!payload.summary) throw new Error("Release summary is required");
  if (payload.tickets.some((ticket) => !ticket.review_fingerprint)) throw new Error("Every ticket requires a review fingerprint");
  return { ...payload, status: "PENDING", fingerprint: hash(payload), approved_at: null, consumed_at: null };
}
function approveRelease(record, fingerprint, now = new Date().toISOString()) { if (record.status !== "PENDING") throw new Error("Release approval is not pending"); if (record.fingerprint !== fingerprint) throw new Error("Release approval fingerprint mismatch"); return { ...record, status: "APPROVED", approved_at: now }; }
function requireReleaseApproved(record, fingerprint) { if (record.status !== "APPROVED" || record.consumed_at || record.fingerprint !== fingerprint) throw new Error("Explicit unconsumed release approval is required"); return true; }
function consumeReleaseApproval(record, fingerprint, now = new Date().toISOString()) { requireReleaseApproved(record, fingerprint); return { ...record, status: "CONSUMED", consumed_at: now }; }
function beginReleaseApply(record, fingerprint, now = new Date().toISOString()) { requireReleaseApproved(record, fingerprint); if (record.release?.operation === "record") throw new Error("Record-only approval cannot execute Git operations"); return { ...record, status: "APPLYING", consumed_at: now, result: null }; }
function finishReleaseApply(record, result, now = new Date().toISOString()) { if (record.status !== "APPLYING") throw new Error("Release is not applying"); return { ...record, status: "APPLIED", applied_at: now, result }; }
function failReleaseApply(record, error, partialResults = [], now = new Date().toISOString()) { if (record.status !== "APPLYING") throw new Error("Release is not applying"); return { ...record, status: "FAILED", failed_at: now, result: { error: String(error || "Unknown managed Git failure"), partial_results: partialResults } }; }
function addEvidence(ledger, item) {
  if (!item.project_id || !item.ticket_id || !item.title) throw new Error("Evidence requires project, ticket, and title");
  if (!new Set(["DRAFT", "VERIFIED"]).has(item.status)) throw new Error("Evidence status must be DRAFT or VERIFIED");
  if (item.status === "VERIFIED" && !item.commit && !item.pr) throw new Error("Verified evidence requires a commit or PR");
  const visibility = item.visibility || "private";
  if (!new Set(["private", "public"]).has(visibility)) throw new Error("Evidence visibility must be private or public");
  return [...ledger, { ...item, visibility, id: hash(item).slice(0, 12), created_at: item.created_at || new Date().toISOString() }];
}

function upsertManagedCommitDraft(ledger, { project, ticket, commit, requestId, approvalId, now = new Date().toISOString() }) {
  const id = hash({ project_id: project.id, ticket_id: ticket.ticket_id, commit }).slice(0, 12);
  if (ledger.some((item) => item.id === id)) return ledger;
  return [...ledger, {
    id,
    project_id: project.id,
    ticket_id: ticket.ticket_id,
    request_id: requestId,
    approval_id: approvalId,
    title: ticket.goal || ticket.ticket_id,
    status: "DRAFT",
    visibility: "private",
    technologies: [...(project.stacks || [])],
    problem: ticket.context_summary || ticket.goal || "Not recorded",
    solution: (ticket.implementation_steps || []).join("; ") || "See managed commit",
    result: ticket.verification?.summary || "Managed commit recorded; outcome review pending",
    acceptance_criteria: [...(ticket.acceptance_criteria || [])],
    changed_paths: [...(ticket.verification?.changed_paths || [])],
    commit,
    source: "managed-commit",
    created_at: now
  }];
}

function validateEvidenceReference(item, { projects, executions, runGit }) {
  const project = projects[item.project_id];
  if (!project) throw new Error(`Evidence project is not registered: ${item.project_id}`);
  const ticketExists = executions.some((execution) => execution.tickets?.some((ticket) => (
    ticket.ticket_id === item.ticket_id && ticket.project_id === item.project_id
  )));
  if (!ticketExists) throw new Error(`Evidence ticket is not recorded for project: ${item.ticket_id}`);
  if (item.commit) {
    if (!/^[0-9a-f]{7,40}$/i.test(item.commit)) throw new Error("Evidence commit must be a 7-40 character Git SHA");
    const result = runGit(["cat-file", "-e", `${item.commit}^{commit}`], project.path);
    if (result.status !== 0 || result.error) throw new Error(`Evidence commit does not exist in project: ${item.commit}`);
  }
  if (item.pr) {
    let url;
    try { url = new URL(item.pr); } catch { throw new Error("Evidence PR must be a valid HTTPS URL"); }
    if (url.protocol !== "https:" || !/(\/pull\/\d+|\/merge_requests\/\d+)\/?$/.test(url.pathname)) {
      throw new Error("Evidence PR must be an HTTPS pull or merge request URL");
    }
  }
  return true;
}

function searchEvidence(ledger, query, { includeDrafts = false, projectId, technology, from, to } = {}) {
  const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  const fromTime = from ? Date.parse(from) : null;
  const toTime = to ? Date.parse(to) : null;
  if (from && Number.isNaN(fromTime)) throw new Error("Invalid evidence search start date");
  if (to && Number.isNaN(toTime)) throw new Error("Invalid evidence search end date");
  return ledger.filter((item) => {
    const itemTime = Date.parse(item.created_at || 0);
    return (includeDrafts || item.status === "VERIFIED")
      && (!projectId || item.project_id === projectId)
      && (!technology || (item.technologies || []).some((value) => value.toLowerCase() === String(technology).toLowerCase()))
      && (!fromTime || itemTime >= fromTime)
      && (!toTime || itemTime <= toTime)
      && terms.every((term) => JSON.stringify(item).toLowerCase().includes(term));
  });
}

function publicVerifiedEvidence(ledger) {
  return ledger.filter((item) => item.status === "VERIFIED" && item.visibility === "public");
}

function exportEvidenceMarkdown(ledger) {
  return publicVerifiedEvidence(ledger).map((item) => `## ${item.title}\n- Project: ${item.project_id}\n- Ticket: ${item.ticket_id}\n- Technologies: ${(item.technologies || []).join(", ") || "not recorded"}\n- Result: ${item.result || "Verified"}\n- Evidence: ${item.commit || item.pr}`).join("\n\n");
}
module.exports = { addEvidence, approveRelease, beginReleaseApply, consumeReleaseApproval, createReleaseApproval, exportEvidenceMarkdown, failReleaseApply, finishReleaseApply, normalizeReleaseSpec, publicVerifiedEvidence, requireReleaseApproved, searchEvidence, upsertManagedCommitDraft, validateEvidenceReference };
