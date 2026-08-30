"use strict";

const crypto = require("node:crypto");

const SCHEMA_VERSION = "1.0";
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function requireId(value, label) {
  const id = String(value || "").trim();
  if (!ID_PATTERN.test(id)) throw new Error(`${label} must be kebab-case`);
  return id;
}

function planFingerprint(plan) {
  const stable = {
    schema_version: plan.schema_version,
    request_id: plan.request_id,
    status: plan.status,
    approved_at: plan.approved_at,
    goal: plan.goal,
    assumptions: plan.assumptions,
    exclusions: plan.exclusions,
    tickets: plan.tickets,
    notification_policy: plan.notification_policy
  };
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function validateTicketGraph(tickets) {
  const ids = new Set(tickets.map((ticket) => ticket.ticket_id));
  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(tickets.map((ticket) => [ticket.ticket_id, ticket]));
  const visit = (id) => {
    if (visiting.has(id)) throw new Error(`Ticket dependency cycle detected at: ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).depends_on) {
      if (!ids.has(dependency)) throw new Error(`Unknown ticket dependency: ${dependency}`);
      if (dependency === id) throw new Error(`Ticket cannot depend on itself: ${id}`);
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
}

function createRequestPlan({ requestId, goal, projectIds = [], tickets = [], profiles, assumptions = [], exclusions = [], now = new Date().toISOString() }) {
  const id = requireId(requestId, "Request id");
  const normalizedGoal = String(goal || "").trim();
  if (!normalizedGoal) throw new Error("Request goal is required");
  const requestedTickets = tickets.length > 0
    ? tickets
    : projectIds.map((projectId) => ({ ticket_id: `${id}-${projectId}`, project_id: projectId, goal: normalizedGoal }));
  if (requestedTickets.length === 0) throw new Error("At least one project or ticket is required");

  const normalizedTickets = requestedTickets.map((ticket) => {
    const projectId = requireId(ticket.project_id, "Project id");
    const profile = profiles[projectId];
    if (!profile || profile.status !== "APPROVED") throw new Error(`Approved onboarding profile required: ${projectId}`);
    const ticketId = requireId(ticket.ticket_id, "Ticket id");
    const ticketGoal = String(ticket.goal || "").trim();
    if (!ticketGoal) throw new Error(`Ticket goal is required: ${ticketId}`);
    return {
      ticket_id: ticketId,
      project_id: projectId,
      goal: ticketGoal,
      scope: Array.isArray(ticket.scope) ? ticket.scope.map(String) : [ticketGoal],
      exclusions: Array.isArray(ticket.exclusions) ? ticket.exclusions.map(String) : [],
      depends_on: Array.isArray(ticket.depends_on) ? ticket.depends_on.map((value) => requireId(value, "Dependency id")) : [],
      verification: Array.isArray(ticket.verification) && ticket.verification.length > 0
        ? ticket.verification.map(String)
        : [...profile.verify_commands],
      profile_fingerprint: profile.content_fingerprint
    };
  });
  if (new Set(normalizedTickets.map((ticket) => ticket.ticket_id)).size !== normalizedTickets.length) {
    throw new Error("Ticket ids must be unique within a request");
  }
  validateTicketGraph(normalizedTickets);

  const plan = {
    schema_version: SCHEMA_VERSION,
    request_id: id,
    status: "DRAFT",
    goal: normalizedGoal,
    assumptions: assumptions.map(String),
    exclusions: exclusions.map(String),
    tickets: normalizedTickets,
    notification_policy: {
      plan_ready: true,
      blocked: true,
      review_ready: true,
      commit_approval_required: true
    },
    generated_at: now,
    approved_at: null
  };
  plan.content_fingerprint = planFingerprint(plan);
  return plan;
}

function validateRequestPlan(plan) {
  if (plan?.schema_version !== SCHEMA_VERSION || !plan.request_id || !Array.isArray(plan.tickets)) {
    throw new Error(`Request plan must use schema_version ${SCHEMA_VERSION}`);
  }
  if (planFingerprint(plan) !== plan.content_fingerprint) throw new Error("Request plan fingerprint does not match its content");
  return plan;
}

function approveRequestPlan(plan, now = new Date().toISOString()) {
  validateRequestPlan(plan);
  if (plan.status !== "DRAFT") throw new Error("Only a DRAFT request plan can be approved");
  const approved = { ...plan, status: "APPROVED", approved_at: now };
  approved.content_fingerprint = planFingerprint(approved);
  return approved;
}

function requireRequestReady(plan, profiles) {
  validateRequestPlan(plan);
  if (plan.status !== "APPROVED") throw new Error(`Request plan is not approved: ${plan.request_id}`);
  for (const ticket of plan.tickets) {
    const profile = profiles[ticket.project_id];
    if (!profile || profile.status !== "APPROVED") throw new Error(`Project profile is not approved: ${ticket.project_id}`);
    if (profile.content_fingerprint !== ticket.profile_fingerprint) {
      throw new Error(`Project profile changed after planning: ${ticket.project_id}`);
    }
  }
  return true;
}

module.exports = {
  approveRequestPlan,
  createRequestPlan,
  planFingerprint,
  requireRequestReady,
  validateTicketGraph,
  validateRequestPlan
};
