"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { updateJsonLocked } = require("./control-plane-state");
const { readOnboardingProfile } = require("./project-onboarding");
const {
  approveRequestPlan,
  createRequestPlan,
  requireRequestReady,
  validateRequestPlan
} = require("./request-plan");
const { readRegistry, validateProjectId } = require("./project-registry");

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

function createRequestCommand({ root, parseArgs, log }) {
  const localRoot = path.join(root, ".harness", "local");
  const registryPath = path.join(localRoot, "projects.json");
  const requestPath = (id) => path.join(localRoot, "requests", `${validateProjectId(id)}.json`);
  const profilePath = (id) => path.join(localRoot, "profiles", `${id}.json`);
  const loadProfiles = (projectIds) => Object.fromEntries(projectIds.map((id) => [id, readOnboardingProfile(profilePath(id))]));

  return function commandRequest(args) {
    const { positional, options } = parseArgs(args);
    const [action, rawId] = positional;
    const id = validateProjectId(rawId);

    if (new Set(["create", "revise"]).has(action)) {
      const registry = readRegistry(registryPath);
      let input = {};
      if (action === "revise" && !options["plan-file"]) throw new Error("request revise requires --plan-file <json>");
      if (options["plan-file"]) {
        input = JSON.parse(fs.readFileSync(path.resolve(options["plan-file"]), "utf8"));
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

    if (action === "approve") {
      const plan = updateJsonLocked(requestPath(id), null, (current) => {
        if (!current) throw new Error(`Unknown request plan: ${id}`);
        return approveRequestPlan(validateRequestPlan(current));
      });
      log(`[APPROVED] Request plan ${id} (${plan.content_fingerprint.slice(0, 12)})`);
      return plan;
    }

    if (action === "ready") {
      const plan = readPlan(requestPath(id));
      const projectIds = [...new Set(plan.tickets.map((ticket) => ticket.project_id))];
      requireRequestReady(plan, loadProfiles(projectIds));
      log(`[READY] Request plan ${id} is approved and profile-bound`);
      return plan;
    }

    throw new Error("Usage: request <create|revise|show|approve|ready> <id> [--project <id,...>] [--goal <text>] [--plan-file <json>]");
  };
}

module.exports = { createRequestCommand, readPlan };
