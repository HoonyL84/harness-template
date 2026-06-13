"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  listTaskRuns,
  readRunState,
  requireRuntimeBudget,
  reserveProviderBudget,
  saveRunState,
  stateDir,
  statePath
} = require("../../tools/harness-cli/orchestration-state");
const { createOrchestrationState } = require("../../tools/harness-cli/orchestration-utils");

function createState(root, overrides = {}) {
  return saveRunState(root, {
    ...createOrchestrationState({
      runId: "state-20260614T000000Z",
      task: "state-test",
      mode: "sequential",
      adapter: "sequential-local",
      baseCommit: "abc123",
      parentBranch: "codex/state-test",
      maxApiCalls: 3
    }),
    ...overrides
  });
}

test("orchestration state persists and is discoverable by task", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-state-"));
  const saved = createState(root);

  assert.equal(readRunState(root, saved.run_id).task, "state-test");
  assert.equal(listTaskRuns(root, "state-test").length, 1);
  assert.equal(fs.existsSync(statePath(root, saved.run_id)), true);
});

test("provider budget updates atomically and rejects overflow", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-state-budget-"));
  let state = createState(root);
  const config = {
    now: () => new Date(Date.parse(state.budget.deadline_at) - 1000).toISOString()
  };

  state = reserveProviderBudget(root, state, 2, config);
  assert.equal(state.budget.api_calls, 2);
  assert.throws(() => reserveProviderBudget(root, state, 2, config), /budget exhausted/);
  assert.equal(readRunState(root, state.run_id).budget_exhausted_reason, "api_calls");
});

test("state paths reject invalid run identifiers and missing runs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-state-path-"));

  assert.throws(() => stateDir(root, "../escape"), /run id is invalid/);
  assert.throws(() => readRunState(root, "missing-run"), /run not found/);
});

test("runtime budget fails closed for missing and expired deadlines", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-state-runtime-"));
  const missing = createState(root, { budget: {} });
  assert.throws(() => requireRuntimeBudget(root, missing, {}), /metadata is missing/);

  const expiredRoot = fs.mkdtempSync(path.join(os.tmpdir(), "harness-state-expired-"));
  const expired = createState(expiredRoot);
  assert.throws(() => requireRuntimeBudget(expiredRoot, expired, {
    now: () => new Date(Date.parse(expired.budget.deadline_at) + 1000).toISOString()
  }), /runtime budget is exhausted/);
  assert.equal(readRunState(expiredRoot, expired.run_id).budget_exhausted_reason, "runtime");
});
