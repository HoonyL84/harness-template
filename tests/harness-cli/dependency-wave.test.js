"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { createControlPlaneCommands } = require("../../tools/harness-cli/control-plane-command");
const { repositoryContentFingerprint } = require("../../tools/harness-cli/content-fingerprint");
const { createExecutionCommand } = require("../../tools/harness-cli/execution-command");
const { createOnboardingProfile, fingerprintProfile } = require("../../tools/harness-cli/project-onboarding");
const { dependencyReadiness } = require("../../tools/harness-cli/project-execution");
const { inspectGitProject } = require("../../tools/harness-cli/project-registry");
const { approveRequestPlan, createRequestPlan } = require("../../tools/harness-cli/request-plan");

function parseArgs(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith("--")) positional.push(args[index]);
    else options[args[index].slice(2)] = args[index + 1] && !args[index + 1].startsWith("--") ? args[++index] : true;
  }
  return { positional, options };
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "", error: result.error };
}

function requireGit(t) {
  const result = runGit(["--version"], process.cwd());
  if (result.error || result.status !== 0) {
    t.skip(`Git unavailable in test environment: ${result.error?.message || result.stderr}`);
    return false;
  }
  return true;
}

test("dependency readiness waits for commits and rejects implicit same-project fan-in", () => {
  const state = { tickets: [
    { ticket_id: "one", project_id: "demo", committed_sha: "111" },
    { ticket_id: "two", project_id: "demo", committed_sha: null },
    { ticket_id: "next", project_id: "demo", depends_on: ["one", "two"] }
  ] };
  assert.match(dependencyReadiness(state.tickets[2], state).reason, /two/);
  state.tickets[1].committed_sha = "222";
  const fanIn = dependencyReadiness(state.tickets[2], state);
  assert.equal(fanIn.ready, false);
  assert.equal(fanIn.fan_in, true);
  assert.match(fanIn.reason, /integration ticket/);
});

test("ticket-scoped commit advances a dependent worktree from the managed predecessor SHA", (t) => {
  if (!requireGit(t)) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-wave-central-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-wave-project-"));
  assert.equal(runGit(["init", "-b", "main"], project).status, 0);
  assert.equal(runGit(["config", "user.name", "Harness Test"], project).status, 0);
  assert.equal(runGit(["config", "user.email", "harness@example.invalid"], project).status, 0);
  fs.writeFileSync(path.join(project, "README.md"), "base\n");
  assert.equal(runGit(["add", "README.md"], project).status, 0);
  assert.equal(runGit(["commit", "-m", "initial"], project).status, 0);

  const diagnosis = inspectGitProject(project, runGit);
  const projectRecord = { id: "demo", name: "demo", ...diagnosis };
  const draftProfile = createOnboardingProfile(projectRecord, diagnosis, [], []);
  const profile = { ...draftProfile, status: "APPROVED", approved_at: "2026-08-30T00:00:00.000Z" };
  profile.content_fingerprint = fingerprintProfile(profile);
  const plan = approveRequestPlan(createRequestPlan({
    requestId: "linear-work",
    goal: "Linear work",
    profiles: { demo: profile },
    tickets: [
      { ticket_id: "first", project_id: "demo", goal: "First", verification: ["verify"] },
      { ticket_id: "second", project_id: "demo", goal: "Second", depends_on: ["first"], verification: ["verify"] }
    ]
  }));
  const local = path.join(root, ".harness", "local");
  fs.mkdirSync(path.join(local, "profiles"), { recursive: true });
  fs.mkdirSync(path.join(local, "requests"), { recursive: true });
  fs.writeFileSync(path.join(local, "projects.json"), JSON.stringify({ schema_version: "1.0", projects: { demo: projectRecord } }));
  fs.writeFileSync(path.join(local, "profiles", "demo.json"), JSON.stringify(profile));
  fs.writeFileSync(path.join(local, "requests", "linear-work.json"), JSON.stringify(plan));

  const fingerprint = (worktree) => repositoryContentFingerprint(worktree, runGit);
  const execution = createExecutionCommand({
    root,
    parseArgs,
    reviewFingerprint: fingerprint,
    runCommand: () => ({ status: 0, stdout: "passed", stderr: "" }),
    runGit,
    tokenizeCommand: (value) => [value],
    log: () => {}
  });
  let state = execution(["prepare", "linear-work"]);
  const first = state.tickets.find((ticket) => ticket.ticket_id === "first");
  const second = state.tickets.find((ticket) => ticket.ticket_id === "second");
  assert.equal(first.status, "PREPARED");
  assert.equal(second.status, "WAITING_DEPENDENCY");
  assert.equal(fs.existsSync(second.worktree), false);

  fs.writeFileSync(path.join(first.worktree, "first.txt"), "from predecessor\n");
  state = execution(["review-ready", "linear-work", "--ticket", "first"]);
  assert.equal(state.tickets.find((ticket) => ticket.ticket_id === "first").status, "REVIEW_READY");
  const control = createControlPlaneCommands({ root, parseArgs, notify: async () => ({ sent: 0 }), reviewFingerprint: fingerprint, runGit, log: () => {} });
  const pending = control.release(["request", "linear-work", "--ticket", "first", "--approval", "first-commit", "--summary", "reviewed", "--operation", "commit", "--message", "feat: first"]);
  control.release(["approve", "first-commit", "--fingerprint", pending.fingerprint]);
  control.release(["apply", "first-commit", "--fingerprint", pending.fingerprint]);
  state = execution(["advance", "linear-work"]);
  const committedFirst = state.tickets.find((ticket) => ticket.ticket_id === "first");
  const preparedSecond = state.tickets.find((ticket) => ticket.ticket_id === "second");
  assert.equal(preparedSecond.status, "PREPARED");
  assert.equal(preparedSecond.base_commit, committedFirst.committed_sha);
  assert.equal(fs.readFileSync(path.join(preparedSecond.worktree, "first.txt"), "utf8").replace(/\r\n/g, "\n"), "from predecessor\n");
  assert.equal(state.tickets.filter((ticket) => ticket.release_history?.length).length, 1);
});
