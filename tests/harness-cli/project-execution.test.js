"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createExecutionCommand } = require("../../tools/harness-cli/execution-command");
const { assertProjectSnapshot, buildExecutionState, finalizeExecutionState } = require("../../tools/harness-cli/project-execution");

function parseArgs(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith("--")) positional.push(args[index]);
    else options[args[index].slice(2)] = args[++index];
  }
  return { positional, options };
}

test("execution state isolates every project ticket in a deterministic worktree", () => {
  const plan = { request_id: "demo", content_fingerprint: "fingerprint", tickets: [
    { ticket_id: "ad-cache", project_id: "ad-server", verification: ["npm test"] },
    { ticket_id: "payment-retry", project_id: "payments", depends_on: ["ad-cache"] }
  ] };
  const state = buildExecutionState(plan, path.resolve("root"), "2026-01-01T00:00:00Z");
  assert.notEqual(state.tickets[0].worktree, state.tickets[1].worktree);
  assert.equal(state.tickets[0].branch, "codex/demo/ad-cache");
  assert.match(state.tickets[0].worktree, /ad-server[\\/]demo[\\/]ad-cache$/);
  assert.deepEqual(state.tickets[1].depends_on, ["ad-cache"]);
  assert.deepEqual(state.tickets[0].verification_commands, ["npm test"]);
  state.tickets[0].status = "PREPARED";
  state.tickets[1].status = "BLOCKED";
  assert.equal(finalizeExecutionState(state).status, "BLOCKED");
  state.tickets[1].status = "PREPARED";
  assert.equal(finalizeExecutionState(state).status, "PREPARED");
  state.tickets[0].status = "REVIEW_READY";
  assert.equal(finalizeExecutionState(state).status, "IN_PROGRESS");
  state.tickets[1].status = "REVIEW_READY";
  assert.equal(finalizeExecutionState(state).status, "REVIEW_READY");
});

test("execution rejects stale onboarding snapshots", () => {
  const profile = { project_id: "demo", status: "APPROVED", git: { head: "abc", worktree_fingerprint: "one" } };
  assert.doesNotThrow(() => assertProjectSnapshot(profile, { head: "abc", worktree_fingerprint: "one" }));
  assert.throws(() => assertProjectSnapshot(profile, { head: "def", worktree_fingerprint: "one" }), /HEAD changed/);
  assert.throws(() => assertProjectSnapshot(profile, { head: "abc", worktree_fingerprint: "two" }), /worktree changed/);
});

test("execution requires fingerprint-bound verification before review readiness", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-execution-review-"));
  const worktree = path.join(root, "worktree");
  const executionDir = path.join(root, ".harness", "local", "executions");
  fs.mkdirSync(worktree);
  fs.mkdirSync(executionDir, { recursive: true });
  fs.writeFileSync(path.join(executionDir, "demo.json"), JSON.stringify({
    request_id: "demo",
    status: "PREPARED",
    tickets: [{ ticket_id: "cache", project_id: "ads", worktree, status: "PREPARED", verification_commands: ["npm test"] }]
  }));
  const invoked = [];
  const command = createExecutionCommand({
    root,
    parseArgs,
    reviewFingerprint: () => "current-content",
    runCommand: (executable, args, options) => { invoked.push({ executable, args, options }); return { status: 0, stdout: "passed", stderr: "" }; },
    runGit: () => ({ status: 0 }),
    tokenizeCommand: (value) => value.split(" "),
    log: () => {}
  });
  const state = command(["review-ready", "demo", "--ticket", "cache"]);
  assert.equal(state.status, "REVIEW_READY");
  assert.equal(state.tickets[0].verification.content_fingerprint, "current-content");
  assert.equal(invoked[0].options.cwd, worktree);
  assert.throws(() => command(["review-ready", "demo", "--ticket", "cache"]), /must be PREPARED/);
});

test("execution stays prepared when a real verification command fails", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-execution-fail-"));
  const worktree = path.join(root, "worktree");
  const executionDir = path.join(root, ".harness", "local", "executions");
  fs.mkdirSync(worktree);
  fs.mkdirSync(executionDir, { recursive: true });
  fs.writeFileSync(path.join(executionDir, "demo.json"), JSON.stringify({ request_id: "demo", status: "PREPARED", tickets: [{ ticket_id: "cache", project_id: "ads", worktree, status: "PREPARED", verification_commands: ["npm test"] }] }));
  const command = createExecutionCommand({ root, parseArgs, reviewFingerprint: () => "unused", runCommand: () => ({ status: 1, stdout: "", stderr: "failed" }), runGit: () => ({ status: 0 }), tokenizeCommand: (value) => value.split(" "), log: () => {} });
  assert.throws(() => command(["review-ready", "demo", "--ticket", "cache"]), /Verification failed/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(executionDir, "demo.json"))).tickets[0].status, "PREPARED");
});
