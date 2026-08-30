"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

function buildExecutionState(plan, root, now = new Date().toISOString()) {
  const tickets = plan.tickets.map((ticket) => ({
    ticket_id: ticket.ticket_id,
    project_id: ticket.project_id,
    depends_on: [...(ticket.depends_on || [])],
    verification_commands: [...(ticket.verification || [])],
    branch: `codex/${plan.request_id}/${ticket.ticket_id}`,
    worktree: path.join(root, ".worktrees", "projects", ticket.project_id, plan.request_id, ticket.ticket_id),
    base_commit: null,
    status: "PENDING",
    error: null
  }));
  return {
    schema_version: "1.0",
    execution_id: `${plan.request_id}-${crypto.createHash("sha256").update(plan.content_fingerprint).digest("hex").slice(0, 8)}`,
    request_id: plan.request_id,
    request_fingerprint: plan.content_fingerprint,
    status: "PREPARING",
    created_at: now,
    updated_at: now,
    tickets
  };
}

function finalizeExecutionState(state, now = new Date().toISOString()) {
  state.updated_at = now;
  if (state.tickets.some((ticket) => ticket.status === "BLOCKED")) state.status = "BLOCKED";
  else if (state.tickets.every((ticket) => ticket.status === "REVIEW_READY")) state.status = "REVIEW_READY";
  else if (state.tickets.every((ticket) => ticket.status === "PREPARED")) state.status = "PREPARED";
  else if (state.tickets.every((ticket) => new Set(["PREPARED", "REVIEW_READY"]).has(ticket.status))) state.status = "IN_PROGRESS";
  return state;
}

function assertProjectSnapshot(profile, diagnosis) {
  if (profile.status !== "APPROVED") throw new Error(`Project profile is not approved: ${profile.project_id}`);
  if (profile.git.head !== diagnosis.head) throw new Error(`Project HEAD changed after onboarding: ${profile.project_id}`);
  if (profile.git.worktree_fingerprint !== diagnosis.worktree_fingerprint) {
    throw new Error(`Project worktree changed after onboarding: ${profile.project_id}`);
  }
}

module.exports = { assertProjectSnapshot, buildExecutionState, finalizeExecutionState };
