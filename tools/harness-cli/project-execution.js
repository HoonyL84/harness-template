"use strict";

const crypto = require("node:crypto");
const path = require("node:path");

function buildExecutionState(plan, root, now = new Date().toISOString()) {
  const tickets = plan.tickets.map((ticket) => ({
    ticket_id: ticket.ticket_id,
    project_id: ticket.project_id,
    goal: ticket.goal,
    scope: [...(ticket.scope || [])],
    exclusions: [...(ticket.exclusions || [])],
    context_summary: ticket.context_summary || "",
    acceptance_criteria: [...(ticket.acceptance_criteria || [])],
    implementation_steps: [...(ticket.implementation_steps || [])],
    test_plan: Object.fromEntries(Object.entries(ticket.test_plan || {}).map(([key, values]) => [key, [...values]])),
    retry_policy: { ...ticket.retry_policy },
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
  else if (state.tickets.every((ticket) => ticket.status === "WAITING_DEPENDENCY")) state.status = "WAITING_DEPENDENCY";
  else if (state.tickets.every((ticket) => new Set(["PREPARED", "WAITING_DEPENDENCY"]).has(ticket.status))) state.status = "PREPARED";
  else if (state.tickets.every((ticket) => new Set(["PREPARED", "WAITING_DEPENDENCY", "REVIEW_READY", "RUNNING", "VERIFYING"]).has(ticket.status))) state.status = "IN_PROGRESS";
  return state;
}

function dependencyReadiness(ticket, state) {
  const dependencies = (ticket.depends_on || []).map((dependencyId) => state.tickets.find((item) => item.ticket_id === dependencyId));
  const missing = dependencies.filter((dependency) => !dependency?.committed_sha).map((dependency) => dependency?.ticket_id).filter(Boolean);
  if (missing.length > 0) {
    return { ready: false, reason: `Waiting for committed dependencies: ${missing.join(", ")}` };
  }
  const sameProject = dependencies.filter((dependency) => dependency.project_id === ticket.project_id);
  if (sameProject.length > 1) {
    return {
      ready: false,
      fan_in: true,
      reason: `Same-project fan-in requires an explicitly approved integration ticket: ${sameProject.map((item) => item.ticket_id).join(", ")}`
    };
  }
  return {
    ready: true,
    base_commit: sameProject[0]?.committed_sha || null,
    base_ticket: sameProject[0]?.ticket_id || null,
    dependencies
  };
}

function assertProjectSnapshot(profile, diagnosis) {
  if (profile.status !== "APPROVED") throw new Error(`Project profile is not approved: ${profile.project_id}`);
  if (profile.git.head !== diagnosis.head) throw new Error(`Project HEAD changed after onboarding: ${profile.project_id}`);
  if (profile.git.worktree_fingerprint !== diagnosis.worktree_fingerprint) {
    throw new Error(`Project worktree changed after onboarding: ${profile.project_id}`);
  }
}

function assertExecutionMatchesPlan(state, plan, root) {
  if (state.request_id !== plan.request_id || state.request_fingerprint !== plan.content_fingerprint) {
    throw new Error("Execution is not bound to the approved request fingerprint");
  }
  const expected = buildExecutionState(plan, root);
  if (state.tickets.length !== expected.tickets.length) throw new Error("Execution ticket set changed after planning");
  const immutableFields = ["project_id", "depends_on", "verification_commands", "branch"];
  const optionalImmutableFields = ["goal", "scope", "exclusions", "context_summary", "acceptance_criteria", "implementation_steps", "test_plan", "retry_policy"];
  for (const expectedTicket of expected.tickets) {
    const ticket = state.tickets.find((item) => item.ticket_id === expectedTicket.ticket_id);
    if (!ticket) throw new Error(`Execution ticket changed after planning: ${expectedTicket.ticket_id}`);
    for (const field of immutableFields) {
      if (JSON.stringify(ticket[field]) !== JSON.stringify(expectedTicket[field])) {
        throw new Error(`Execution ${field} changed after planning: ${ticket.ticket_id}`);
      }
    }
    for (const field of optionalImmutableFields) {
      if (ticket[field] !== undefined && JSON.stringify(ticket[field]) !== JSON.stringify(expectedTicket[field])) {
        throw new Error(`Execution ${field} changed after planning: ${ticket.ticket_id}`);
      }
    }
    const comparable = (value) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
    if (comparable(ticket.worktree) !== comparable(expectedTicket.worktree)) {
      throw new Error(`Execution worktree changed after planning: ${ticket.ticket_id}`);
    }
  }
  return true;
}

module.exports = { assertExecutionMatchesPlan, assertProjectSnapshot, buildExecutionState, dependencyReadiness, finalizeExecutionState };
