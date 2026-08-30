"use strict";

const crypto = require("node:crypto");
const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

function createReleaseApproval(execution, summary) {
  if (execution.status !== "REVIEW_READY") throw new Error("Execution must be REVIEW_READY before release approval");
  const payload = { execution_id: execution.execution_id, request_id: execution.request_id, summary: String(summary || "").trim(), tickets: execution.tickets.map(({ ticket_id, project_id, branch, worktree, base_commit, review_fingerprint, verification }) => ({ ticket_id, project_id, branch, worktree, base_commit, review_fingerprint, verification })) };
  if (!payload.summary) throw new Error("Release summary is required");
  if (payload.tickets.some((ticket) => !ticket.review_fingerprint)) throw new Error("Every ticket requires a review fingerprint");
  return { ...payload, status: "PENDING", fingerprint: hash(payload), approved_at: null, consumed_at: null };
}
function approveRelease(record, fingerprint, now = new Date().toISOString()) { if (record.status !== "PENDING") throw new Error("Release approval is not pending"); if (record.fingerprint !== fingerprint) throw new Error("Release approval fingerprint mismatch"); return { ...record, status: "APPROVED", approved_at: now }; }
function requireReleaseApproved(record, fingerprint) { if (record.status !== "APPROVED" || record.consumed_at || record.fingerprint !== fingerprint) throw new Error("Explicit unconsumed release approval is required"); return true; }
function consumeReleaseApproval(record, fingerprint, now = new Date().toISOString()) { requireReleaseApproved(record, fingerprint); return { ...record, status: "CONSUMED", consumed_at: now }; }
function addEvidence(ledger, item) {
  if (!item.project_id || !item.ticket_id || !item.title) throw new Error("Evidence requires project, ticket, and title");
  if (!new Set(["DRAFT", "VERIFIED"]).has(item.status)) throw new Error("Evidence status must be DRAFT or VERIFIED");
  if (item.status === "VERIFIED" && !item.commit && !item.pr) throw new Error("Verified evidence requires a commit or PR");
  const visibility = item.visibility || "private";
  if (!new Set(["private", "public"]).has(visibility)) throw new Error("Evidence visibility must be private or public");
  return [...ledger, { ...item, visibility, id: hash(item).slice(0, 12), created_at: item.created_at || new Date().toISOString() }];
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
module.exports = { addEvidence, approveRelease, consumeReleaseApproval, createReleaseApproval, exportEvidenceMarkdown, publicVerifiedEvidence, requireReleaseApproved, searchEvidence, validateEvidenceReference };
