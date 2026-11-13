"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createExecutionCommand } = require("../../tools/harness-cli/execution-command");
const { assertExecutionMatchesPlan, assertProjectSnapshot, buildExecutionState, dependencyReadiness, finalizeExecutionState } = require("../../tools/harness-cli/project-execution");
const { approveRequestPlan, createRequestPlan } = require("../../tools/harness-cli/request-plan");
const { createVerificationOwner, reconcileVerificationLeases } = require("../../tools/harness-cli/verification-lease");
const { reconcileExpiredLeases } = require("../../tools/harness-cli/agent-runner");

function parseArgs(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith("--")) positional.push(args[index]);
    else options[args[index].slice(2)] = args[++index];
  }
  return { positional, options };
}

function preparedExecution(root) {
  const profile = { status: "APPROVED", content_fingerprint: "profile", verify_commands: ["npm test"] };
  const plan = approveRequestPlan(createRequestPlan({ requestId: "demo", goal: "Cache", projectIds: ["ads"], profiles: { ads: profile } }));
  const state = buildExecutionState(plan, root);
  state.status = "PREPARED";
  state.tickets[0].status = "PREPARED";
  fs.mkdirSync(state.tickets[0].worktree, { recursive: true });
  fs.mkdirSync(path.join(root, ".harness", "local", "executions"), { recursive: true });
  fs.mkdirSync(path.join(root, ".harness", "local", "requests"), { recursive: true });
  fs.writeFileSync(path.join(root, ".harness", "local", "executions", "demo.json"), JSON.stringify(state));
  fs.writeFileSync(path.join(root, ".harness", "local", "requests", "demo.json"), JSON.stringify(plan));
  return state.tickets[0];
}

test("execution state isolates every project ticket in a deterministic worktree", () => {
  const plan = { request_id: "demo", content_fingerprint: "fingerprint", tickets: [
    { ticket_id: "ad-cache", project_id: "ad-server", retry_policy: { max_attempts: 2, stop_on_same_error: true }, verification: ["npm test"] },
    { ticket_id: "payment-retry", project_id: "payments", retry_policy: { max_attempts: 2, stop_on_same_error: true }, depends_on: ["ad-cache"] }
  ] };
  const state = buildExecutionState(plan, path.resolve("root"), "2026-01-01T00:00:00Z");
  assert.notEqual(state.tickets[0].worktree, state.tickets[1].worktree);
  assert.equal(state.tickets[0].branch, "codex/demo/ad-cache");
  assert.match(state.tickets[0].worktree, /ad-server[\\/]demo[\\/]ad-cache$/);
  assert.deepEqual(state.tickets[1].depends_on, ["ad-cache"]);
  assert.deepEqual(state.tickets[0].verification_commands, ["npm test"]);
  assert.deepEqual(state.tickets[0].retry_policy, plan.tickets[0].retry_policy);
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

test("execution state distinguishes dependency waiting from runnable work", () => {
  const state = { tickets: [
    { ticket_id: "first", project_id: "demo", status: "PREPARED", depends_on: [] },
    { ticket_id: "second", project_id: "demo", status: "WAITING_DEPENDENCY", depends_on: ["first"] }
  ] };
  assert.equal(finalizeExecutionState(state).status, "PREPARED");
  assert.match(dependencyReadiness(state.tickets[1], state).reason, /first/);
  state.tickets[0].committed_sha = "abc";
  assert.deepEqual(dependencyReadiness(state.tickets[1], state), {
    ready: true,
    base_commit: "abc",
    base_ticket: "first",
    dependencies: [state.tickets[0]]
  });
});

test("execution rejects stale onboarding snapshots", () => {
  const profile = { project_id: "demo", status: "APPROVED", git: { head: "abc", worktree_fingerprint: "one" } };
  assert.doesNotThrow(() => assertProjectSnapshot(profile, { head: "abc", worktree_fingerprint: "one" }));
  assert.throws(() => assertProjectSnapshot(profile, { head: "def", worktree_fingerprint: "one" }), /HEAD changed/);
  assert.throws(() => assertProjectSnapshot(profile, { head: "abc", worktree_fingerprint: "two" }), /worktree changed/);
  assert.throws(() => assertProjectSnapshot({ ...profile, git: { ...profile.git, dirty: true } }, { head: "abc", worktree_fingerprint: "one", dirty: true }), /worktree is dirty/);
  assert.throws(() => assertProjectSnapshot(profile, { head: "abc", worktree_fingerprint: "one", dirty: true }), /worktree is dirty/);
});

test("execution immutable fields remain bound to the approved request", () => {
  const plan = { request_id: "demo", content_fingerprint: "fingerprint", tickets: [{ ticket_id: "cache", project_id: "ads", goal: "Add cache", scope: ["cache"], exclusions: [], context_summary: "legacy", acceptance_criteria: ["works"], implementation_steps: ["edit adapter"], test_plan: { unit: ["unit test"], integration: [], regression: [], manual: [] }, depends_on: [], verification: ["npm test"] }] };
  const state = buildExecutionState(plan, path.resolve("root"));
  assert.equal(assertExecutionMatchesPlan(state, plan, path.resolve("root")), true);
  state.tickets[0].verification_commands = ["unsafe command"];
  assert.throws(() => assertExecutionMatchesPlan(state, plan, path.resolve("root")), /verification_commands changed/);
  const retryState = buildExecutionState(plan, path.resolve("root"));
  retryState.tickets[0].retry_policy.max_attempts = 5;
  assert.throws(() => assertExecutionMatchesPlan(retryState, plan, path.resolve("root")), /retry_policy changed/);
  const detailState = buildExecutionState(plan, path.resolve("root"));
  detailState.tickets[0].acceptance_criteria = ["tampered"];
  assert.throws(() => assertExecutionMatchesPlan(detailState, plan, path.resolve("root")), /acceptance_criteria changed/);
});

test("execution requires fingerprint-bound verification before review readiness", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-execution-review-"));
  const prepared = preparedExecution(root);
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
  const state = command(["review-ready", "demo", "--ticket", prepared.ticket_id]);
  assert.equal(state.status, "REVIEW_READY");
  assert.equal(state.tickets[0].verification.content_fingerprint, "current-content");
  assert.equal(invoked[0].options.cwd, prepared.worktree);
  assert.throws(() => command(["review-ready", "demo", "--ticket", prepared.ticket_id]), /must be PREPARED/);
});

test("execution stays prepared when a real verification command fails", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-execution-fail-"));
  const prepared = preparedExecution(root);
  const command = createExecutionCommand({ root, parseArgs, reviewFingerprint: () => "unused", runCommand: () => ({ status: 1, stdout: "", stderr: "failed" }), runGit: () => ({ status: 0 }), tokenizeCommand: (value) => value.split(" "), log: () => {} });
  assert.throws(() => command(["review-ready", "demo", "--ticket", prepared.ticket_id]), /Verification failed/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, ".harness", "local", "executions", "demo.json"))).tickets[0].status, "PREPARED");
});

test("execution rejects changes during verification and can be reverified", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-verify-drift-"));
  const prepared = preparedExecution(root);
  let content = "before";
  let mutate = true;
  const command = createExecutionCommand({ root, parseArgs, reviewFingerprint: () => content,
    runCommand: () => { if (mutate) content = "after"; return { status: 0 }; },
    runGit: () => ({ status: 0 }), tokenizeCommand: (value) => value.split(" "), log: () => {} });
  const args = ["review-ready", "demo", "--ticket", prepared.ticket_id];
  assert.throws(() => command(args), /changed during verification/);
  const failed = JSON.parse(fs.readFileSync(path.join(root, ".harness", "local", "executions", "demo.json"))).tickets[0];
  assert.equal(failed.status, "PREPARED");
  assert.equal(failed.verification, undefined);
  assert.equal(failed.verification_owner, undefined);
  mutate = false;
  assert.equal(command(args).tickets[0].verification.content_fingerprint, "after");
});

test("verification recovery preserves live owners and requires a fresh verification", () => {
  const owner = createVerificationOwner(0);
  const ticket = { status: "VERIFYING", verification_lease: "old", verification_owner: owner, verification: { content_fingerprint: "stale" } };
  const state = { tickets: [ticket] };
  assert.equal(reconcileVerificationLeases(state, 1, () => false), false);
  assert.equal(reconcileVerificationLeases(state, 3600000, () => true), false);
  assert.equal(reconcileVerificationLeases(state, 3600000, () => false), true);
  assert.equal(ticket.status, "PREPARED");
  assert.equal(ticket.verification, undefined);
  assert.equal(ticket.verification_lease, undefined);
  const live = { tickets: [{ status: "VERIFYING", verification_owner: owner }] };
  assert.equal(reconcileExpiredLeases(live, Date.now()), false);
  const unknown = { tickets: [{ status: "VERIFYING" }, { status: "VERIFYING", verification_owner: { ...owner, host: "other-host" } }] };
  assert.equal(reconcileVerificationLeases(unknown, Date.now(), () => false), false);
});

function parseExecutionTestArgs(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith("--")) positional.push(args[index]);
    else {
      const key = args[index].slice(2);
      const next = args[index + 1];
      if (!next || next.startsWith("--")) options[key] = true;
      else {
        options[key] = next;
        index += 1;
      }
    }
  }
  return { positional, options };
}

function setupMultiProjectFixture(root) {
  const projectPath = path.join(root, "repo-ads");
  fs.mkdirSync(projectPath, { recursive: true });
  const profile = {
    schema_version: "1.0",
    project_id: "ads",
    project_path: projectPath,
    status: "APPROVED",
    approved_at: "2026-01-01T00:00:00Z",
    git: { head: "base000", branch: "main", dirty: false, changed_paths: 0, worktree_fingerprint: "wt0", remotes: [] },
    stacks: ["node"],
    verify_commands: ["npm test"],
    context: { files: [], warnings: [] },
    execution_policy: { source: "registered-git-project", workspace: "isolated-worktree" }
  };
  const crypto = require("node:crypto");
  const { fingerprintProfile } = require("../../tools/harness-cli/project-onboarding");
  profile.content_fingerprint = fingerprintProfile(profile);

  const plan = approveRequestPlan(createRequestPlan({
    requestId: "demo",
    goal: "Two steps",
    profiles: { ads: profile },
    tickets: [
      { ticket_id: "first", project_id: "ads", goal: "First step" },
      { ticket_id: "second", project_id: "ads", goal: "Second step", depends_on: ["first"] }
    ]
  }));
  const state = buildExecutionState(plan, root);
  state.tickets[0].status = "PREPARED";
  state.tickets[0].base_commit = "base000";
  state.tickets[1].status = "WAITING_DEPENDENCY";
  finalizeExecutionState(state);

  fs.mkdirSync(state.tickets[0].worktree, { recursive: true });
  fs.mkdirSync(path.join(root, ".harness", "local", "executions"), { recursive: true });
  fs.mkdirSync(path.join(root, ".harness", "local", "requests"), { recursive: true });
  fs.mkdirSync(path.join(root, ".harness", "local", "profiles"), { recursive: true });
  fs.writeFileSync(path.join(root, ".harness", "local", "projects.json"), JSON.stringify({
    schema_version: "1.0",
    projects: { ads: { id: "ads", path: projectPath, stacks: ["node"], head: "base000" } }
  }));
  fs.writeFileSync(path.join(root, ".harness", "local", "profiles", "ads.json"), JSON.stringify(profile));
  fs.writeFileSync(path.join(root, ".harness", "local", "requests", "demo.json"), JSON.stringify(plan));
  fs.writeFileSync(path.join(root, ".harness", "local", "executions", "demo.json"), JSON.stringify(state));
  assert.ok(crypto.createHash("sha256"));
  return { projectPath, profile, plan, state };
}

test("execution sync-base rebases clean worktrees, handles conflicts, and guards REVIEW_READY", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-sync-base-"));
  const { projectPath, state } = setupMultiProjectFixture(root);
  let mainHead = "base111";
  let isAncestor = true;
  let dirtyWorktree = "";
  let rebaseConflict = false;
  const gitCalls = [];

  const command = createExecutionCommand({
    root,
    parseArgs: parseExecutionTestArgs,
    reviewFingerprint: () => "fp-1",
    runCommand: () => ({ status: 0, stdout: "ok", stderr: "" }),
    runGit: (args, cwd) => {
      gitCalls.push({ args, cwd });
      const cmd = args.join(" ");
      if (cwd === projectPath) {
        if (cmd === "rev-parse --show-toplevel") return { status: 0, stdout: `${projectPath}\n` };
        if (cmd === "rev-parse HEAD") return { status: 0, stdout: `${mainHead}\n` };
        if (cmd === "branch --show-current") return { status: 0, stdout: "main\n" };
        if (cmd === "status --porcelain=v1 --untracked-files=all") return { status: 0, stdout: "" };
        if (cmd === "remote -v") return { status: 0, stdout: "" };
        if (cmd === `merge-base --is-ancestor base000 ${mainHead}`) return { status: isAncestor ? 0 : 1, stdout: "" };
      }
      if (cmd === "status --porcelain=v1 --untracked-files=all") return { status: 0, stdout: dirtyWorktree };
      if (cmd === "branch --show-current") return { status: 0, stdout: `${state.tickets[0].branch}\n` };
      if (cmd === `rebase ${mainHead}`) return rebaseConflict ? { status: 1, stderr: "CONFLICT" } : { status: 0, stdout: "" };
      if (cmd === "rebase --abort") return { status: 0, stdout: "" };
      return { status: 1, stderr: `unexpected git: ${cmd}` };
    },
    tokenizeCommand: (v) => v.split(" "),
    log: () => {}
  });

  dirtyWorktree = " M index.js\n";
  assert.throws(() => command(["sync-base", "demo"]), /clean ticket worktree/);
  dirtyWorktree = "";

  rebaseConflict = true;
  assert.throws(() => command(["sync-base", "demo"]), /Rebase conflict/);
  assert.ok(gitCalls.some((c) => c.args.join(" ") === "rebase --abort"));
  rebaseConflict = false;

  isAncestor = false;
  assert.throws(() => command(["sync-base", "demo"]), /diverged/);
  isAncestor = true;

  const synced = command(["sync-base", "demo"]);
  assert.equal(synced.tickets[0].base_commit, "base111");
  assert.equal(synced.synced_project_snapshots.ads.head, "base111");

  const reviewed = command(["review-ready", "demo", "--ticket", "first"]);
  assert.equal(reviewed.tickets[0].status, "REVIEW_READY");

  mainHead = "base222";
  assert.throws(() => command(["sync-base", "demo"]), /--reset-review/);
  const resynced = command(["sync-base", "demo", "--reset-review"]);
  assert.equal(resynced.tickets[0].status, "PREPARED");
  assert.equal(resynced.tickets[0].base_commit, "base222");
  assert.equal(resynced.tickets[0].verification, undefined);
});

test("execution complete records external PR merge evidence and transitions state to COMPLETED", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-complete-"));
  const { projectPath } = setupMultiProjectFixture(root);
  const current = JSON.parse(fs.readFileSync(path.join(root, ".harness", "local", "executions", "demo.json"), "utf8"));
  current.tickets[1].status = "PREPARED";
  current.tickets[1].base_commit = "base000";
  fs.mkdirSync(current.tickets[1].worktree, { recursive: true });
  fs.writeFileSync(path.join(root, ".harness", "local", "executions", "demo.json"), JSON.stringify(current));

  const command = createExecutionCommand({
    root,
    parseArgs: parseExecutionTestArgs,
    reviewFingerprint: () => "fp-done",
    runCommand: () => ({ status: 0, stdout: "ok", stderr: "" }),
    runGit: (args, cwd) => {
      if (cwd === projectPath && args[0] === "cat-file") {
        return args[2] === "deadbee^{commit}" ? { status: 0 } : { status: 1, stderr: "Not a valid object" };
      }
      return { status: 0 };
    },
    tokenizeCommand: (v) => v.split(" "),
    log: () => {}
  });

  command(["review-ready", "demo", "--ticket", "first"]);
  assert.throws(() => command(["complete", "demo", "--pr", "#1"]), /--summary/);
  assert.throws(() => command(["complete", "demo", "--summary", "done"]), /external release evidence/);
  assert.throws(() => command(["complete", "demo", "--summary", "done", "--pr", "#1"]), /must be REVIEW_READY/);

  const partial = command(["complete", "demo", "--ticket", "first", "--summary", "Merged PR #1", "--pr", "#1", "--commit", "deadbee"]);
  assert.equal(partial.status, "IN_PROGRESS");
  assert.equal(partial.tickets[0].status, "COMPLETED");
  assert.equal(partial.tickets[0].external_release.pr, "#1");

  command(["review-ready", "demo", "--ticket", "second"]);
  assert.throws(() => command(["complete", "demo", "--ticket", "second", "--summary", "bad sha", "--commit", "0000000"]), /Not a valid object/);
  const finished = command(["complete", "demo", "--summary", "Merged PR #2", "--pr", "https://github.com/org/repo/pull/2"]);
  assert.equal(finished.status, "COMPLETED");
  assert.equal(finished.tickets[1].status, "COMPLETED");
  assert.throws(() => command(["complete", "demo", "--summary", "again", "--pr", "#3"]), /already COMPLETED/);
});

test("execution advance succeeds after sync-base when main advances forward", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-advance-synced-"));
  const { projectPath, state } = setupMultiProjectFixture(root);
  const current = JSON.parse(fs.readFileSync(path.join(root, ".harness", "local", "executions", "demo.json"), "utf8"));
  current.tickets[0].committed_sha = "commit01";
  current.tickets[0].release_history = [{ operation: "commit", commit: "commit01" }];
  current.tickets[0].status = "REVIEW_READY";
  current.tickets[0].base_commit = "base111";
  fs.writeFileSync(path.join(root, ".harness", "local", "executions", "demo.json"), JSON.stringify(current));

  const command = createExecutionCommand({
    root,
    parseArgs: parseExecutionTestArgs,
    reviewFingerprint: () => "fp-sync",
    runCommand: () => ({ status: 0 }),
    runGit: (args, cwd) => {
      const cmd = args.join(" ");
      if (cwd === projectPath) {
        if (cmd === "rev-parse --show-toplevel") return { status: 0, stdout: `${projectPath}\n` };
        if (cmd === "rev-parse HEAD") return { status: 0, stdout: "base111\n" };
        if (cmd === "branch --show-current") return { status: 0, stdout: "main\n" };
        if (cmd === "status --porcelain=v1 --untracked-files=all") return { status: 0, stdout: "" };
        if (cmd === "remote -v") return { status: 0, stdout: "" };
        if (cmd === "merge-base --is-ancestor base000 base111") return { status: 0 };
        if (cmd === `rev-parse refs/heads/${state.tickets[0].branch}`) return { status: 0, stdout: "commit01\n" };
        if (cmd === "merge-base --is-ancestor base111 commit01") return { status: 0 };
        if (cmd === "cat-file -e commit01^{commit}") return { status: 0 };
        if (args[0] === "show-ref") return { status: 1 };
        if (args[0] === "worktree" && args[1] === "add") {
          fs.mkdirSync(args[4], { recursive: true });
          return { status: 0 };
        }
      }
      return { status: 1, stderr: `unexpected: ${cmd}` };
    },
    tokenizeCommand: (v) => v.split(" "),
    log: () => {}
  });

  command(["sync-base", "demo"]);
  const advanced = command(["advance", "demo"]);
  assert.equal(advanced.tickets[1].status, "PREPARED");
  assert.equal(advanced.tickets[1].base_commit, "commit01");
});
