"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  commandOrchestrate,
  recordArtifact,
  requireTaskOrchestrationReady,
  saveRunState
} = require("../../tools/harness-cli/orchestration-command");
const { createOrchestrationState } = require("../../tools/harness-cli/orchestration-utils");

function config(overrides = {}) {
  return {
    enabled: false,
    defaultMode: "sequential",
    adapter: "auto",
    maxWorkers: 2,
    allowMultiWriter: false,
    ...overrides
  };
}

test("orchestrate --capabilities reports detected native support while disabled", async () => {
  const lines = [];
  const result = await commandOrchestrate({
    root: process.cwd(),
    args: ["--capabilities"],
    config: config(),
    env: {
      HARNESS_AGENT_MODE: "interactive",
      HARNESS_AGENT_CAPABILITIES: JSON.stringify({
        delegation: true,
        parallel: true,
        workspace_write: false,
        interactive_approval: true
      })
    },
    log: (line) => lines.push(line)
  });

  assert.equal(result.action, "capabilities");
  assert.equal(result.detected.adapter, "native-host");
  assert.match(lines.join("\n"), /enabled\s+: false/);
  assert.match(lines.join("\n"), /adapter\s+: native-host/);
  assert.match(lines.join("\n"), /parallel\s+: true/);
  assert.match(lines.join("\n"), /fallback\s+: false/);
});

test("orchestrate fails closed when multi-agent is disabled", async () => {
  await assert.rejects(() => commandOrchestrate({
    root: process.cwd(),
    args: ["optional-multi-agent"],
    config: config(),
    env: {},
    log: () => {}
  }), /Multi-agent orchestration is disabled/);
});

test("planning artifacts move single-writer runs to implementation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-orchestration-command-"));
  let state = createOrchestrationState({
    runId: "demo-20260613T000000Z",
    task: "demo",
    mode: "parallel",
    adapter: "native-host",
    baseCommit: "abc123",
    parentBranch: "codex/demo"
  });
  state = saveRunState(root, state);
  state = recordArtifact(root, state, "planner", { role: "planner", summary: "plan" });
  assert.equal(state.phase, "planning");
  state = recordArtifact(root, state, "architect", { role: "architect", summary: "design" });
  assert.equal(state.phase, "implementation");
  assert.equal(state.status, "awaiting_implementation");
});

test("review artifacts require promotion for integrated runs and full verify for single writer", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-orchestration-review-"));
  const base = {
    ...createOrchestrationState({
      runId: "demo-20260613T000001Z",
      task: "demo",
      mode: "parallel",
      adapter: "native-host",
      baseCommit: "abc123",
      parentBranch: "codex/demo"
    }),
    phase: "review",
    status: "awaiting_host"
  };
  let singleWriter = saveRunState(root, base);
  singleWriter = recordArtifact(root, singleWriter, "reviewer", { role: "reviewer" });
  singleWriter = recordArtifact(root, singleWriter, "verifier", { role: "verifier" });
  assert.equal(singleWriter.status, "full_verify_required");

  let integrated = saveRunState(root, {
    ...base,
    run_id: "demo-20260613T000002Z",
    integration: { branch: "orchestrate/demo/integration" }
  });
  integrated = recordArtifact(root, integrated, "reviewer", { role: "reviewer" });
  integrated = recordArtifact(root, integrated, "verifier", { role: "verifier" });
  assert.equal(integrated.status, "review_passed");
});

test("review findings block progression until they are resolved", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-orchestration-findings-"));
  let state = saveRunState(root, {
    ...createOrchestrationState({
      runId: "demo-20260613T000003Z",
      task: "demo",
      mode: "sequential",
      adapter: "sequential-local",
      baseCommit: "abc123",
      parentBranch: "codex/demo"
    }),
    phase: "review",
    status: "awaiting_host"
  });

  state = recordArtifact(root, state, "reviewer", {
    role: "reviewer",
    findings: ["A correctness issue remains."]
  });
  state = recordArtifact(root, state, "verifier", { role: "verifier" });

  assert.equal(state.phase, "review");
  assert.equal(state.status, "review_blocked");
});

test("finish requires verification phase and a current full verify result", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-orchestration-finish-"));
  const runId = "demo-20260613T000004Z";
  saveRunState(root, {
    ...createOrchestrationState({
      runId,
      task: "demo",
      mode: "sequential",
      adapter: "sequential-local",
      baseCommit: "abc123",
      parentBranch: "codex/demo"
    }),
    phase: "verification",
    status: "full_verify_required"
  });

  await assert.rejects(() => commandOrchestrate({
    root,
    args: ["--finish", runId],
    config: config({ isFullVerifyCurrent: () => false }),
    env: {},
    log: () => {}
  }), /current verify --full result is required/);

  const finished = await commandOrchestrate({
    root,
    args: ["--finish", runId],
    config: config({ isFullVerifyCurrent: () => true }),
    env: {},
    log: () => {}
  });
  assert.equal(finished.phase, "completed");
  assert.equal(finished.status, "ready_to_complete");
});

test("unfinished orchestration blocks task completion readiness", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-orchestration-ready-"));
  const runId = "demo-20260613T000005Z";
  const state = createOrchestrationState({
    runId,
    task: "demo",
    mode: "sequential",
    adapter: "sequential-local",
    baseCommit: "abc123",
    parentBranch: "codex/demo"
  });
  saveRunState(root, state);

  assert.throws(
    () => requireTaskOrchestrationReady(root, "demo"),
    /unfinished orchestration runs/
  );

  saveRunState(root, state, { phase: "completed", status: "ready_to_complete" });
  assert.doesNotThrow(() => requireTaskOrchestrationReady(root, "demo"));
});
