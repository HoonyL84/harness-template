"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ORCHESTRATION_SCHEMA_VERSION = "1.0";
const ARTIFACT_SCHEMA_VERSION = "1.0";
const VALID_MODES = new Set(["auto", "native", "api", "sequential"]);
const VALID_ADAPTERS = new Set(["auto", "native-host", "provider-api", "sequential-local"]);
const VALID_ROLES = new Set(["planner", "architect", "implementer", "reviewer", "verifier"]);
const HIGH_RISK_SEGMENTS = new Set([
  ".github", "deploy", "deployment", "helm", "infra", "k8s", "kubernetes",
  "migrations", "scripts", "terraform"
]);
const HIGH_RISK_FILES = new Set([
  "docker-compose.yml", "docker-compose.yaml", "dockerfile", "package.json",
  "package-lock.json", "pnpm-lock.yaml", "yarn.lock", "pom.xml",
  "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"
]);
const FORBIDDEN_OWNERSHIP_SEGMENTS = new Set([
  ".git", ".harness", ".worktrees", "node_modules", "observability"
]);

function normalizePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/")
    .trim();
}

function parseCapabilityManifest(raw) {
  if (!raw) return null;
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    throw new Error(`HARNESS_AGENT_CAPABILITIES must be valid JSON: ${error.message}`);
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error("HARNESS_AGENT_CAPABILITIES must contain a JSON object.");
  }
  return {
    delegation: manifest.delegation === true,
    parallel: manifest.parallel === true,
    isolatedContext: manifest.isolated_context === true,
    toolAccess: manifest.tool_access === true,
    workspaceWrite: manifest.workspace_write === true,
    interactiveApproval: manifest.interactive_approval === true,
    cancellation: manifest.cancellation === true
  };
}

function detectCapabilities({ agentMode = "interactive", adapter = "auto", env = {} } = {}) {
  if (!VALID_ADAPTERS.has(adapter)) throw new Error(`Unsupported adapter: ${adapter}`);
  const host = parseCapabilityManifest(env.HARNESS_AGENT_CAPABILITIES);
  const apiConfigured = agentMode === "api";

  let selectedAdapter = adapter;
  if (selectedAdapter === "auto") {
    if (host?.delegation) selectedAdapter = "native-host";
    else if (apiConfigured) selectedAdapter = "provider-api";
    else selectedAdapter = "sequential-local";
  }
  if (selectedAdapter === "native-host" && !host?.delegation) {
    selectedAdapter = "sequential-local";
  }
  if (selectedAdapter === "provider-api" && !apiConfigured) {
    selectedAdapter = "sequential-local";
  }

  const capabilities = selectedAdapter === "native-host"
    ? host
    : selectedAdapter === "provider-api"
      ? {
          delegation: true,
          parallel: true,
          isolatedContext: true,
          toolAccess: false,
          workspaceWrite: false,
          interactiveApproval: false,
          cancellation: false
        }
      : {
          delegation: false,
          parallel: false,
          isolatedContext: false,
          toolAccess: false,
          workspaceWrite: true,
          interactiveApproval: true,
          cancellation: false
        };

  return {
    adapter: selectedAdapter,
    capabilities,
    fallback: selectedAdapter === "sequential-local"
  };
}

function selectMode(requestedMode, detected) {
  const mode = requestedMode || "auto";
  if (!VALID_MODES.has(mode)) throw new Error(`Unsupported orchestration mode: ${mode}`);
  if (mode === "auto") {
    return detected.capabilities.parallel ? "parallel" : "sequential";
  }
  if (mode === "native") {
    return detected.adapter === "native-host" ? "parallel" : "sequential";
  }
  if (mode === "api") {
    return detected.adapter === "provider-api" ? "parallel" : "sequential";
  }
  return "sequential";
}

function normalizeArtifact(input, expectedRole) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Agent artifact must be a JSON object.");
  }
  const role = String(input.role || expectedRole || "").trim();
  if (!VALID_ROLES.has(role)) throw new Error(`Unsupported artifact role: ${role}`);
  if (expectedRole && role !== expectedRole) {
    throw new Error(`Artifact role mismatch: expected ${expectedRole}, received ${role}.`);
  }
  const list = (value, label) => {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      throw new Error(`${label} must be an array of strings.`);
    }
    return value.map((item) => item.trim()).filter(Boolean);
  };
  const status = String(input.status || "completed");
  if (!["completed", "failed", "approval_required"].includes(status)) {
    throw new Error(`Unsupported artifact status: ${status}`);
  }
  return {
    schema_version: ARTIFACT_SCHEMA_VERSION,
    role,
    status,
    summary: String(input.summary || "").trim(),
    assumptions: list(input.assumptions, "assumptions"),
    findings: list(input.findings, "findings"),
    proposed_actions: list(input.proposed_actions, "proposed_actions"),
    owned_paths: list(input.owned_paths, "owned_paths").map(normalizePath),
    approval_required: input.approval_required === true
  };
}

function pathSegments(repoPath) {
  return normalizePath(repoPath).toLowerCase().split("/").filter(Boolean);
}

function classifyOwnedPath(repoPath) {
  const normalized = normalizePath(repoPath);
  if (!normalized || path.isAbsolute(normalized) || /^[a-zA-Z]:\//.test(normalized)
      || normalized.startsWith("../")
      || normalized.includes("/../")) {
    return { safe: false, reason: "path must stay repository-relative" };
  }
  const firstSegment = normalized.split("/")[0];
  if (!firstSegment || /[*?[\]{}]/.test(firstSegment)) {
    return { safe: false, reason: "path must have a concrete repository root before glob segments" };
  }
  const segments = pathSegments(normalized);
  if (segments.some((segment) => FORBIDDEN_OWNERSHIP_SEGMENTS.has(segment))) {
    return { safe: false, reason: "path contains a protected harness segment" };
  }
  const fileName = segments.at(-1);
  if (segments.some((segment) => HIGH_RISK_SEGMENTS.has(segment))
      || HIGH_RISK_FILES.has(fileName)) {
    return { safe: false, approvalRequired: true, reason: "path is high risk" };
  }
  return { safe: true };
}

function pathsOverlap(left, right) {
  const normalizeOwnership = (value) => normalizePath(value)
    .replace(/\/\*\*$/, "")
    .replace(/\/\*$/, "")
    .replace(/\*.*$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
  const a = normalizeOwnership(left);
  const b = normalizeOwnership(right);
  return Boolean(a && b && (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)));
}

function validateWorkerPlan(plan, { maxWorkers = 2, allowMultiWriter = false } = {}) {
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.workers)) {
    throw new Error("Worker plan must contain a workers array.");
  }
  if (plan.workers.length === 0) throw new Error("Worker plan must contain at least one worker.");
  if (plan.workers.length > maxWorkers) {
    throw new Error(`Worker plan exceeds max_workers=${maxWorkers}.`);
  }
  if (plan.workers.length > 1 && !allowMultiWriter) {
    throw new Error("Multiple writing workers require multi_agent.allow_multi_writer=true.");
  }

  const ids = new Set();
  const workers = plan.workers.map((worker, index) => {
    const id = String(worker.id || `worker-${index + 1}`).trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
      throw new Error(`Worker id must be kebab-case: ${id}`);
    }
    if (ids.has(id)) throw new Error(`Duplicate worker id: ${id}`);
    ids.add(id);
    if (!Array.isArray(worker.owned_paths) || worker.owned_paths.length === 0) {
      throw new Error(`Worker ${id} must own at least one path.`);
    }
    const ownedPaths = worker.owned_paths.map(normalizePath);
    const pathChecks = ownedPaths.map((ownedPath) => ({
      path: ownedPath,
      ...classifyOwnedPath(ownedPath)
    }));
    const blocked = pathChecks.find((check) => !check.safe);
    if (blocked && !blocked.approvalRequired) {
      throw new Error(`Worker ${id} cannot own ${blocked.path}: ${blocked.reason}.`);
    }
    return {
      id,
      goal: String(worker.goal || "").trim(),
      depends_on: Array.isArray(worker.depends_on)
        ? worker.depends_on.map((dependency) => String(dependency).trim()).filter(Boolean)
        : [],
      owned_paths: ownedPaths,
      approval_required: pathChecks.some((check) => check.approvalRequired)
    };
  });

  for (const worker of workers) {
    for (const dependency of worker.depends_on) {
      if (!ids.has(dependency)) throw new Error(`Worker ${worker.id} has unknown dependency: ${dependency}`);
      if (dependency === worker.id) throw new Error(`Worker ${worker.id} cannot depend on itself.`);
    }
  }
  detectDependencyCycle(workers);

  for (let left = 0; left < workers.length; left += 1) {
    for (let right = left + 1; right < workers.length; right += 1) {
      for (const leftPath of workers[left].owned_paths) {
        for (const rightPath of workers[right].owned_paths) {
          if (pathsOverlap(leftPath, rightPath)) {
            throw new Error(
              `Worker ownership overlaps: ${workers[left].id}:${leftPath} and ${workers[right].id}:${rightPath}`
            );
          }
        }
      }
    }
  }
  return {
    workers,
    integration_order: normalizeIntegrationOrder(plan.integration_order, workers),
    approval_required: workers.filter((worker) => worker.approval_required).map((worker) => worker.id)
  };
}

function detectDependencyCycle(workers) {
  const dependencies = new Map(workers.map((worker) => [worker.id, worker.depends_on]));
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) throw new Error(`Worker dependency cycle detected at ${id}.`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) || []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const worker of workers) visit(worker.id);
}

function normalizeIntegrationOrder(order, workers) {
  const workerIds = workers.map((worker) => worker.id);
  if (order === undefined) return workerIds;
  if (!Array.isArray(order) || order.length !== workerIds.length) {
    throw new Error("integration_order must contain every worker exactly once.");
  }
  const normalized = order.map((id) => String(id).trim());
  if (new Set(normalized).size !== workerIds.length
      || normalized.some((id) => !workerIds.includes(id))) {
    throw new Error("integration_order must contain every worker exactly once.");
  }
  return normalized;
}

function createRunId(task, now = new Date()) {
  const timestamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `${task}-${timestamp}`;
}

function createOrchestrationState({
  runId,
  task,
  mode,
  adapter,
  baseCommit,
  parentBranch,
  maxApiCalls = 6,
  maxRuntimeMinutes = 30,
  now = new Date()
}) {
  const deadline = new Date(now.getTime() + maxRuntimeMinutes * 60 * 1000);
  return {
    schema_version: ORCHESTRATION_SCHEMA_VERSION,
    run_id: runId,
    task,
    mode,
    adapter,
    phase: "planning",
    status: "running",
    base_commit: baseCommit,
    parent_branch: parentBranch,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    roles: [],
    workers: [],
    approval_required: [],
    conflicts: [],
    budget: {
      api_calls: 0,
      max_api_calls: maxApiCalls,
      started_at: now.toISOString(),
      deadline_at: deadline.toISOString()
    }
  };
}

function stateFingerprint(state) {
  return crypto.createHash("sha256").update(JSON.stringify(state)).digest("hex");
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function readState(filePath) {
  const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (state.schema_version !== ORCHESTRATION_SCHEMA_VERSION) {
    throw new Error(`Unsupported orchestration schema_version: ${state.schema_version}`);
  }
  if (state.state_fingerprint) {
    const expected = stateFingerprint({ ...state, state_fingerprint: undefined });
    if (state.state_fingerprint !== expected) {
      throw new Error("Orchestration state fingerprint does not match its content.");
    }
  }
  return state;
}

function nextRecoveryAction(state, current = {}) {
  if (!state || typeof state !== "object") return { action: "manual_review", reason: "state is missing" };
  if (current.baseCommit && current.baseCommit !== state.base_commit) {
    return { action: "manual_review", reason: "base commit changed since orchestration started" };
  }
  if (state.status === "approval_required") {
    return { action: "approval_required", reason: "explicit user approval is required" };
  }
  if (state.status === "integration_conflict") {
    return { action: "manual_review", reason: "integration conflict requires manual resolution" };
  }
  if (state.status === "budget_exhausted") {
    return {
      action: "budget_exhausted",
      reason: state.budget_exhausted_reason || "orchestration budget exhausted"
    };
  }
  if (state.phase === "planning") return { action: "resume_planning", reason: "planning is incomplete" };
  if (state.phase === "awaiting_host") return { action: "dispatch_host_roles", reason: "host role results are pending" };
  if (state.phase === "implementation") return { action: "inspect_implementation", reason: "implementation must be reviewed" };
  if (state.phase === "review") return { action: "resume_review", reason: "review or verification is incomplete" };
  if (state.phase === "verification") return { action: "reverify_required", reason: "full verification is required" };
  if (state.status === "ready_to_complete") {
    return { action: "ready_to_complete", reason: "orchestration and full verification completed" };
  }
  return { action: "manual_review", reason: "state does not have a safe automatic continuation" };
}

module.exports = {
  ARTIFACT_SCHEMA_VERSION,
  ORCHESTRATION_SCHEMA_VERSION,
  classifyOwnedPath,
  createOrchestrationState,
  createRunId,
  detectCapabilities,
  nextRecoveryAction,
  normalizeArtifact,
  normalizePath,
  pathsOverlap,
  readState,
  selectMode,
  stateFingerprint,
  validateWorkerPlan,
  writeJsonAtomic
};
