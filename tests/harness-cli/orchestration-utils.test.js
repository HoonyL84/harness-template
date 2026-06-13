"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createConfigLoader, validateConfigSchema } = require("../../tools/harness-cli/config");
const {
  classifyOwnedPath,
  createOrchestrationState,
  detectCapabilities,
  nextRecoveryAction,
  normalizeArtifact,
  readState,
  selectMode,
  validateWorkerPlan,
  writeJsonAtomic
} = require("../../tools/harness-cli/orchestration-utils");

function throwingFail(message) {
  throw new Error(message);
}

test("native capabilities are selected before API and preserve host flags", () => {
  const detected = detectCapabilities({
    agentMode: "api",
    env: {
      HARNESS_AGENT_CAPABILITIES: JSON.stringify({
        delegation: true,
        parallel: true,
        isolated_context: true,
        tool_access: true,
        workspace_write: false,
        interactive_approval: true,
        cancellation: true
      })
    }
  });

  assert.equal(detected.adapter, "native-host");
  assert.equal(detected.fallback, false);
  assert.equal(detected.capabilities.toolAccess, true);
  assert.equal(selectMode("auto", detected), "parallel");
});

test("capability detection selects API or sequential fallback safely", () => {
  const api = detectCapabilities({ agentMode: "api", env: {} });
  assert.equal(api.adapter, "provider-api");
  assert.equal(api.capabilities.parallel, true);
  assert.equal(selectMode("api", api), "parallel");

  const fallback = detectCapabilities({
    agentMode: "interactive",
    adapter: "native-host",
    env: {}
  });
  assert.equal(fallback.adapter, "sequential-local");
  assert.equal(fallback.fallback, true);
  assert.equal(selectMode("native", fallback), "sequential");
});

test("artifacts are normalized and reject role mismatches", () => {
  assert.deepEqual(normalizeArtifact({
    role: "planner",
    summary: " plan ",
    assumptions: [" one ", ""],
    owned_paths: [".\\src\\planner\\**"]
  }, "planner"), {
    schema_version: "1.0",
    role: "planner",
    status: "completed",
    summary: "plan",
    assumptions: ["one"],
    findings: [],
    proposed_actions: [],
    owned_paths: ["src/planner/**"],
    approval_required: false
  });

  assert.throws(
    () => normalizeArtifact({ role: "reviewer" }, "planner"),
    /Artifact role mismatch/
  );
});

test("worker plans reject overlap, cycles, and multi-writer without opt-in", () => {
  const workers = [
    { id: "worker-a", owned_paths: ["src/module/**"], depends_on: ["worker-b"] },
    { id: "worker-b", owned_paths: ["tests/module/**"], depends_on: ["worker-a"] }
  ];
  assert.throws(
    () => validateWorkerPlan({ workers }, { allowMultiWriter: false }),
    /allow_multi_writer=true/
  );
  assert.throws(
    () => validateWorkerPlan({ workers }, { allowMultiWriter: true }),
    /dependency cycle/
  );
  assert.throws(() => validateWorkerPlan({
    workers: [
      { id: "worker-a", owned_paths: ["src/module/**"] },
      { id: "worker-b", owned_paths: ["src/module/file.js"] }
    ]
  }, { allowMultiWriter: true }), /ownership overlaps/);
});

test("worker plans mark high-risk paths for approval", () => {
  const plan = validateWorkerPlan({
    workers: [{ id: "worker-a", owned_paths: ["scripts/release.js"] }]
  });

  assert.deepEqual(plan.approval_required, ["worker-a"]);
  assert.equal(plan.workers[0].approval_required, true);
});

test("worker ownership rejects absolute and repository escape paths", () => {
  assert.equal(classifyOwnedPath("../outside.js").safe, false);
  assert.equal(classifyOwnedPath("C:\\outside.js").safe, false);
  assert.equal(classifyOwnedPath(".harness/config.json").safe, false);
  assert.equal(classifyOwnedPath("**").safe, false);
  assert.equal(classifyOwnedPath("*/safe.js").safe, false);
  assert.equal(classifyOwnedPath("src/**").safe, true);
});

test("atomic state write can be read without leaving a temp file", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-orchestration-state-"));
  const filePath = path.join(root, "run", "state.json");
  const state = createOrchestrationState({
    runId: "demo-20260613T000000Z",
    task: "demo",
    mode: "sequential",
    adapter: "sequential-local",
    baseCommit: "abc123",
    parentBranch: "codex/demo",
    now: new Date("2026-06-13T00:00:00Z")
  });

  writeJsonAtomic(filePath, state);

  assert.deepEqual(readState(filePath), state);
  assert.equal(fs.existsSync(`${filePath}.tmp`), false);
});

test("orchestration state fingerprint detects manual tampering", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-orchestration-tamper-"));
  const filePath = path.join(root, "run", "state.json");
  const state = createOrchestrationState({
    runId: "demo-20260613T000001Z",
    task: "demo",
    mode: "sequential",
    adapter: "sequential-local",
    baseCommit: "abc123",
    parentBranch: "codex/demo",
    now: new Date("2026-06-13T00:00:00Z")
  });
  const { stateFingerprint } = require("../../tools/harness-cli/orchestration-utils");
  const protectedState = {
    ...state,
    state_fingerprint: stateFingerprint({ ...state, state_fingerprint: undefined })
  };
  writeJsonAtomic(filePath, protectedState);

  const tampered = JSON.parse(fs.readFileSync(filePath, "utf8"));
  tampered.status = "ready_to_complete";
  fs.writeFileSync(filePath, JSON.stringify(tampered), "utf8");

  assert.throws(() => readState(filePath), /fingerprint does not match/);
});

test("recovery actions stop on drift and resume safe phases", () => {
  const state = {
    schema_version: "1.0",
    base_commit: "abc123",
    phase: "review",
    status: "running"
  };

  assert.equal(nextRecoveryAction(state).action, "resume_review");
  assert.equal(
    nextRecoveryAction(state, { baseCommit: "different" }).action,
    "manual_review"
  );
  assert.equal(
    nextRecoveryAction({ ...state, status: "approval_required" }).action,
    "approval_required"
  );
  assert.equal(
    nextRecoveryAction({
      ...state,
      status: "budget_exhausted",
      budget_exhausted_reason: "runtime"
    }).action,
    "budget_exhausted"
  );
});

test("multi_agent schema rejects invalid values", () => {
  assert.throws(() => validateConfigSchema({
    config_version: "1.0",
    multi_agent: {
      enabled: "yes",
      default_mode: "fast",
      max_workers: 9
    }
  }, throwingFail), /multi_agent.enabled must be a boolean/);

  assert.throws(() => validateConfigSchema({
    config_version: "1.0",
    multi_agent: { default_mode: "fast" }
  }, throwingFail), /multi_agent.default_mode/);

  assert.throws(() => validateConfigSchema({
    config_version: "1.0",
    multi_agent: { max_workers: 9 }
  }, throwingFail), /integer between 1 and 8/);
});

test("multi_agent environment values override file configuration", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-multi-agent-config-"));
  fs.mkdirSync(path.join(root, ".harness"));
  fs.writeFileSync(path.join(root, ".harness", "config.json"), JSON.stringify({
    config_version: "1.0",
    multi_agent: {
      enabled: false,
      default_mode: "sequential",
      adapter: "auto",
      max_workers: 2,
      allow_multi_writer: false
    }
  }));

  const config = createConfigLoader({
    root,
    argv: ["node", "index.js", "orchestrate"],
    env: {
      HARNESS_MULTI_AGENT_ENABLED: "true",
      HARNESS_MULTI_AGENT_MODE: "native",
      HARNESS_AGENT_ADAPTER: "native-host",
      HARNESS_MULTI_AGENT_MAX_WORKERS: "4",
      HARNESS_MULTI_AGENT_ALLOW_MULTI_WRITER: "true"
    },
    fail: throwingFail
  })().multiAgent;

  assert.deepEqual(config, {
    enabled: true,
    defaultMode: "native",
    adapter: "native-host",
    maxWorkers: 4,
    allowMultiWriter: true
  });
});
