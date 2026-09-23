"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { updateJsonLocked } = require("./control-plane-state");
const { readOnboardingProfile } = require("./project-onboarding");
const {
  approveRequestPlan,
  createRequestPlan,
  normalizePriority,
  planFingerprint,
  requireRequestReady,
  validateRequestPlan
} = require("./request-plan");
const { readRegistry, validateProjectId } = require("./project-registry");
const { readJiraTickets, requireJiraFresh, requirePublishedDraftImported } = require("./jira-input");

function readPlan(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Unknown request plan: ${path.basename(filePath, ".json")}`);
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Request plan is invalid JSON: ${error.message}`);
  }
  return validateRequestPlan(plan);
}

function createRequestCommand({ root, parseArgs, log, env = process.env, fetchImpl = globalThis.fetch }) {
  const localRoot = path.join(root, ".harness", "local");
  const registryPath = path.join(localRoot, "projects.json");
  const requestPath = (id) => path.join(localRoot, "requests", `${validateProjectId(id)}.json`);
  const profilePath = (id) => path.join(localRoot, "profiles", `${id}.json`);
  const loadProfiles = (projectIds) => Object.fromEntries(projectIds.map((id) => [id, readOnboardingProfile(profilePath(id))]));

  return function commandRequest(args) {
    const { positional, options } = parseArgs(args);
    const [action, rawId] = positional;
    const id = validateProjectId(rawId);

    if (action === "import-jira") {
      const projectId = validateProjectId(options.project);
      if (!readRegistry(registryPath).projects[projectId]) throw new Error(`Unknown project: ${projectId}`);
      const keys = String(options.issues || "").split(",").map((key) => key.trim());
      return readJiraTickets(root, projectId, keys, { env, fetchImpl }).then((tickets) => {
        const plan = createRequestPlan({ requestId: id, goal: options.goal || `Review Jira tickets: ${keys.join(", ")}`,
          tickets, profiles: loadProfiles([projectId]) });
        updateJsonLocked(requestPath(id), null, (existing) => {
          if (existing) throw new Error(`Request plan already exists: ${id}; use a new id to import a fresh snapshot`);
          return plan;
        });
        log(`[PLAN_READY] ${id}: ${tickets.length} Jira ticket(s) imported; add implementation and test plans before approval`);
        return plan;
      });
    }

    if (new Set(["create", "revise"]).has(action)) {
      const registry = readRegistry(registryPath);
      let input = {};
      if (action === "revise" && !options["plan-file"]) throw new Error("request revise requires --plan-file <json>");
      if (options["plan-file"]) {
        input = JSON.parse(fs.readFileSync(path.resolve(options["plan-file"]), "utf8"));
      }
      const previous = action === "revise" ? readPlan(requestPath(id)) : null;
      if (previous) {
        for (const ticket of input.tickets || []) {
          const source = previous.tickets.find((item) => item.ticket_id === ticket.ticket_id)?.source;
          if (source) ticket.source = source;
        }
      }
      const projectIds = input.tickets
        ? [...new Set(input.tickets.map((ticket) => validateProjectId(ticket.project_id)))]
        : String(options.project || "").split(",").map((value) => value.trim()).filter(Boolean).map(validateProjectId);
      for (const projectId of projectIds) {
        if (!registry.projects[projectId]) throw new Error(`Unknown project: ${projectId}`);
      }
      const plan = createRequestPlan({
        requestId: id,
        goal: input.goal || options.goal,
        projectIds,
        tickets: input.tickets || [],
        assumptions: input.assumptions || [],
        exclusions: input.exclusions || [],
        profiles: loadProfiles(projectIds)
      });
      updateJsonLocked(requestPath(id), null, (existing) => {
        if (action === "create" && existing) throw new Error(`Request plan already exists: ${id}`);
        if (action === "revise" && !existing) throw new Error(`Unknown request plan: ${id}`);
        if (action === "revise" && existing.status !== "DRAFT") throw new Error("Only a DRAFT request plan can be revised");
        if (previous && existing.content_fingerprint !== previous.content_fingerprint) throw new Error("Request changed while revising; reload it");
        return plan;
      });
      log(`[PLAN_READY] ${id}: ${plan.tickets.length} ticket(s), fingerprint ${plan.content_fingerprint.slice(0, 12)}${action === "revise" ? " (revised)" : ""}`);
      return plan;
    }

    if (action === "show") {
      const plan = readPlan(requestPath(id));
      log(JSON.stringify(plan, null, 2));
      return plan;
    }

    if (action === "priority") {
      const ticketId = validateProjectId(options.ticket);
      const priority = normalizePriority(options.value === undefined ? null : options.value);
      const plan = updateJsonLocked(requestPath(id), null, (current) => {
        if (!current) throw new Error(`Unknown request plan: ${id}`);
        validateRequestPlan(current);
        if (current.status !== "DRAFT") throw new Error("Only a DRAFT request plan can be revised");
        const ticket = current.tickets.find((item) => item.ticket_id === ticketId);
        if (!ticket) throw new Error(`Unknown request ticket: ${ticketId}`);
        ticket.priority = priority;
        current.content_fingerprint = planFingerprint(current);
        return current;
      });
      log(`[PLAN_READY] ${id}: ${ticketId} priority ${priority}; review the updated plan before approval`);
      return plan;
    }

    if (action === "approve") {
      const snapshot = readPlan(requestPath(id));
      const approve = () => {
        const plan = updateJsonLocked(requestPath(id), null, (current) => {
          if (!current) throw new Error(`Unknown request plan: ${id}`);
          if (current.content_fingerprint !== snapshot.content_fingerprint) throw new Error("Request changed while checking Jira; review the new draft");
          requirePublishedDraftImported(root, current);
          return approveRequestPlan(validateRequestPlan(current));
        });
        log(`[APPROVED] Request plan ${id} (${plan.content_fingerprint.slice(0, 12)})`);
        return plan;
      };
      return snapshot.tickets.some((ticket) => ticket.source?.kind === "jira")
        ? requireJiraFresh(root, snapshot, { env, fetchImpl }).then(approve) : approve();
    }

    if (action === "ready") {
      const plan = readPlan(requestPath(id));
      const projectIds = [...new Set(plan.tickets.map((ticket) => ticket.project_id))];
      requireRequestReady(plan, loadProfiles(projectIds));
      const ready = () => {
        if (readPlan(requestPath(id)).content_fingerprint !== plan.content_fingerprint) throw new Error("Request changed during Jira check");
        log(`[READY] Request plan ${id} is approved and profile-bound`);
        return plan;
      };
      return plan.tickets.some((ticket) => ticket.source?.kind === "jira")
        ? requireJiraFresh(root, plan, { env, fetchImpl }).then(ready) : ready();
    }

    throw new Error("Usage: request <create|revise|show|approve|ready|priority|import-jira> <id> [--project <id,...>] [--goal <text>] [--plan-file <json>] [--ticket <id> --value <P0|P1|P2|P3>] [--issues <KEY-1,KEY-2>]");
  };
}

module.exports = { createRequestCommand, readPlan };
