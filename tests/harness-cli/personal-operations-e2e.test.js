"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeJsonAtomic } = require("../../tools/harness-cli/control-plane-state");
const { createOnboardingProfile, approveOnboardingProfile } = require("../../tools/harness-cli/project-onboarding");
const { createRequestCommand } = require("../../tools/harness-cli/request-command");
const { buildExecutionState } = require("../../tools/harness-cli/project-execution");
const { createAgentRunnerCommand } = require("../../tools/harness-cli/agent-runner");
const { createHistoryCommand, withHistory } = require("../../tools/harness-cli/work-history");
const { createAtlassianCommand } = require("../../tools/harness-cli/atlassian-command");
const parseArgs = args => {
  const positional = [], options = {};
  for (let i = 0; i < args.length; i++) args[i].startsWith("--") ? options[args[i].slice(2)] = args[++i] : positional.push(args[i]);
  return { positional, options };
};

test("two-project personal workflow: approval, retry, review, history, explicit publication and process reentry", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "personal-ops-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const local = path.join(root, ".harness", "local"), projects = {};
  for (const id of ["ads", "payments"]) {
    const project = { id, path: path.join(root, id), branch: "main", stacks: ["node"] };
    projects[id] = project; fs.mkdirSync(project.path);
    const diagnosis = { path: project.path, head: "abc", branch: "main", dirty: false, changed_paths: 0,
      worktree_fingerprint: "clean", remotes: {}, stacks: ["node"], verify_commands: ["npm test"] };
    const draft = createOnboardingProfile(project, diagnosis, [], []);
    writeJsonAtomic(path.join(local, "profiles", `${id}.json`), approveOnboardingProfile(draft, draft));
  }
  writeJsonAtomic(path.join(local, "projects.json"), { schema_version: "1.0", projects });
  const planFile = path.join(root, "plan.json");
  writeJsonAtomic(planFile, { goal: "Two project work", tickets: ["ads", "payments"].map(project => ({
    ticket_id: "feature-" + project, project_id: project, goal: `${project} feature`, priority: "P1",
    acceptance_criteria: ["Existing behavior is preserved"], implementation_steps: ["Add regression test"], test_plan: { unit: ["Regression"] } })) });
  const request = withHistory(root, "request", createRequestCommand({ root, parseArgs, log: () => {} }));
  await request(["create", "multi", "--plan-file", planFile]);
  const plan = await request(["approve", "multi"]);
  assert.ok(plan.tickets.every(ticket => ticket.retry_policy.max_attempts === 3));
  // Git checkout preparation and test execution are fixture adapters; real Git isolation has separate E2E tests.
  const state = buildExecutionState(plan, root); state.status = "PREPARED";
  for (const ticket of state.tickets) { ticket.status = "PREPARED"; fs.mkdirSync(ticket.worktree, { recursive: true }); }
  writeJsonAtomic(path.join(local, "executions", "multi.json"), state);
  let calls = 0, notices = 0;
  const runner = withHistory(root, "runner", createAgentRunnerCommand({ root, parseArgs, log: () => {},
    invokeAgent: async () => {
      if (++calls === 1) throw new Error("Transient fixture failure");
      return "diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n";
    }, notify: async () => { notices++; return { sent: 1 }; }, reviewFingerprint: () => "verified",
    runCommand: () => ({ status: 0 }), runGit: () => ({ status: 0 }), tokenizeCommand: value => value.split(" ") }));
  await runner(["run", "multi", "--max-tickets", "2"]);
  assert.equal(calls, 3); assert.equal(notices, 2);
  const history = createHistoryCommand({ root, parseArgs, log: () => {}, reviewFingerprint: () => "verified" });
  assert.equal(history(["list", "--project", "payments", "--status", "REVIEW_READY"]).filter(e => e.kind === "TICKET").length, 1);
  history(["review", "--project", "ads", "--request", "multi", "--ticket", "feature-ads", "--fingerprint", "verified", "--result", "accepted", "--reason", "Fixture user approval"]);
  const reentered = createHistoryCommand({ root, parseArgs, log: () => {} });
  assert.equal(reentered(["search", "--kind", "USER_REVIEW"]).length, 1);
  assert.equal(reentered(["search", "--kind", "ATTEMPT", "--status", "FAILED"]).length, 1);
  writeJsonAtomic(path.join(local, "atlassian.json"), { transport: "rest", site: "https://personal.atlassian.net", jira_projects: {},
    confluence_projects: { ads: { space_id: "1", parent_id: "2" } } });
  const summary = path.join(root, "result.json");
  writeJsonAtomic(summary, { title: "Ads result", summary: "One retry, fixture checks passed, user reviewed. No Git release.", request_id: "multi", ticket_id: "feature-ads" });
  let posts = 0;
  const remote = createAtlassianCommand({ root, parseArgs, log: () => {}, env: { ATLASSIAN_EMAIL: "a@b.c", ATLASSIAN_API_TOKEN: "fixture-key" },
    fetchImpl: async () => { posts++; return new globalThis.Response(JSON.stringify({ id: "3" })); } });
  await remote(["queue-result", "--project", "ads", "--file", summary]); assert.equal(posts, 0);
  const preview = await remote(["preview"]); await remote(["sync", "--approve", preview.approval_digest]); assert.equal(posts, 1);
  assert.equal(reentered(["list", "--project", "ads", "--kind", "TICKET"])[0].remote_records[0].status, "SYNCED");
  assert.equal(fs.existsSync(path.join(local, "releases")), false);
});
