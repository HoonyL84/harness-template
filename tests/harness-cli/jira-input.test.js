"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const test = require("node:test");
const { normalizeJiraSource, readJiraTickets, requireJiraFresh } = require("../../tools/harness-cli/jira-input");
const { createRequestCommand } = require("../../tools/harness-cli/request-command");
const { createExecutionCommand } = require("../../tools/harness-cli/execution-command");
const { createAgentRunnerCommand } = require("../../tools/harness-cli/agent-runner");
const { createControlPlaneCommands } = require("../../tools/harness-cli/control-plane-command");
const { buildExecutionState } = require("../../tools/harness-cli/project-execution");
const { approveOnboardingProfile, createOnboardingProfile, writeOnboardingProfile } = require("../../tools/harness-cli/project-onboarding");
const { emptyRegistry, writeRegistry } = require("../../tools/harness-cli/project-registry");

function parseArgs(args) {
  const positional = [], options = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) options[args[i].slice(2)] = args[++i];
    else positional.push(args[i]);
  }
  return { positional, options };
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-jira-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const local = path.join(root, ".harness", "local");
  fs.mkdirSync(local, { recursive: true });
  const config = { transport: "rest", site: "https://personal.atlassian.net", jira_projects: { demo: "DEMO" }, priority_map: { "2": "P1" } };
  const configPath = path.join(local, "atlassian.json");
  const saveConfig = () => fs.writeFileSync(configPath, JSON.stringify(config));
  saveConfig();
  const issue = { id: "10001", key: "DEMO-1", fields: {
    summary: "Implement idempotency", description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "Do not duplicate payments" }] }] },
    project: { key: "DEMO" }, priority: { id: "2" }, updated: "2026-09-18T00:00:00Z"
  } };
  const env = { ATLASSIAN_EMAIL: "user@example.com", ATLASSIAN_API_TOKEN: "test-secret-value" };
  const options = { env, fetchImpl: async () => new globalThis.Response(JSON.stringify(issue)) };
  return { root, local, config, saveConfig, issue, options };
}

function prepareProject(f) {
  const project = { id: "demo", path: f.root };
  const diagnosis = { path: f.root, head: "abc", branch: "main", dirty: false, changed_paths: 0,
    worktree_fingerprint: "clean", remotes: {}, stacks: ["node"], verify_commands: ["npm test"] };
  const draft = createOnboardingProfile(project, diagnosis, [], []);
  writeOnboardingProfile(path.join(f.local, "profiles", "demo.json"), approveOnboardingProfile(draft, draft));
  const registry = emptyRegistry(); registry.projects.demo = project;
  writeRegistry(path.join(f.local, "projects.json"), registry);
  return createRequestCommand({ root: f.root, parseArgs, log: () => {}, ...f.options });
}

test("Jira read uses fixed endpoints, source identity, priority mapping and bounded timeouts", async t => {
  const f = fixture(t);
  let url, init;
  const tickets = await readJiraTickets(f.root, "demo", ["DEMO-1"], { ...f.options, fetchImpl: async (u, i) => {
    url = u; init = i; return new globalThis.Response(JSON.stringify(f.issue));
  } });
  assert.match(url, /^https:\/\/personal\.atlassian\.net\/rest\/api\/3\/issue\/DEMO-1\?fields=/);
  assert.equal(init.method, "GET"); assert.equal(init.redirect, "error"); assert.ok(init.signal);
  assert.match(init.headers.Authorization, /^Basic /);
  assert.equal(tickets[0].priority, "P1");
  assert.equal(tickets[0].planning_status, "NEEDS_PLAN");
  assert.equal(tickets[0].context_summary, "Do not duplicate payments");
  assert.equal(tickets[0].source.issue_id, "10001");
  assert.ok(!JSON.stringify(tickets).includes(f.options.env.ATLASSIAN_API_TOKEN));
  f.config.cloud_id = "35273b54-3f06-40d2-880f-dd28cf8daafa"; f.saveConfig();
  await readJiraTickets(f.root, "demo", ["DEMO-1"], { ...f.options, fetchImpl: async u => {
    assert.match(u, /^https:\/\/api\.atlassian\.com\/ex\/jira\/35273b54/);
    return new globalThis.Response(JSON.stringify(f.issue));
  } });
});

test("Jira snapshots ignore status-only changes but reject changed requirements and mappings", async t => {
  const f = fixture(t);
  const tickets = await readJiraTickets(f.root, "demo", ["DEMO-1"], f.options);
  f.issue.fields.status = { name: "In Progress" }; f.issue.fields.updated = "2026-09-18T01:00:00Z";
  await requireJiraFresh(f.root, { tickets }, f.options);
  f.issue.fields.summary = "Different task";
  await assert.rejects(requireJiraFresh(f.root, { tickets }, f.options), /inputs changed/);
  f.config.jira_projects.demo = "OTHER"; f.saveConfig();
  await assert.rejects(requireJiraFresh(f.root, { tickets }, f.options), /mapping changed/);
  await requireJiraFresh(f.root, { tickets: [] }, f.options);
});

test("Jira denies malformed origins, foreign projects, missing permissions and secret-bearing failures", async t => {
  const f = fixture(t);
  for (const site of ["http://personal.atlassian.net", "https://evil.test", "https://personal.atlassian.net.evil.test", "https://user:pass@personal.atlassian.net", "https://personal.atlassian.net/a", "https://personal.atlassian.net:444"]) {
    f.config.site = site; f.saveConfig();
    await assert.rejects(readJiraTickets(f.root, "demo", ["DEMO-1"], f.options), /HTTPS tenant/);
  }
  f.config.site = "https://personal.atlassian.net"; f.saveConfig();
  for (const keys of [[], ["OTHER-1"], ["DEMO-1", "DEMO-1"], ["../secret"]]) {
    await assert.rejects(readJiraTickets(f.root, "demo", keys, f.options), /unique issue keys/);
  }
  await assert.rejects(readJiraTickets(f.root, "missing", ["DEMO-1"], f.options), /mapping/);
  await assert.rejects(readJiraTickets(f.root, "demo", ["DEMO-1"], { ...f.options, env: {} }), /Set ATLASSIAN/);
  await assert.rejects(readJiraTickets(f.root, "demo", ["DEMO-1"], { ...f.options, env: { ...f.options.env, HARNESS_OFFLINE: "true" } }), /OFFLINE/);
  for (const status of [401, 403, 404, 429, 500, 302]) {
    await assert.rejects(readJiraTickets(f.root, "demo", ["DEMO-1"], { ...f.options,
      fetchImpl: async () => new globalThis.Response("SECRET RESPONSE", { status }) }), error => {
      assert.match(error.message, new RegExp(`HTTP ${status}`)); assert.ok(!error.message.includes("SECRET")); return true;
    });
  }
  await assert.rejects(readJiraTickets(f.root, "demo", ["DEMO-1"], { ...f.options,
    fetchImpl: async () => { throw new Error(f.options.env.ATLASSIAN_API_TOKEN); } }), /network, timeout or redirect/);
});

test("Jira rejects missing priority mappings, oversized or invalid responses and excessive nesting", async t => {
  const f = fixture(t);
  for (const response of ["not-json", "x".repeat(256 * 1024 + 1)]) {
    await assert.rejects(readJiraTickets(f.root, "demo", ["DEMO-1"], { ...f.options,
      fetchImpl: async () => new globalThis.Response(response) }), /invalid JSON|exceeds/);
  }
  await assert.rejects(readJiraTickets(f.root, "demo", ["DEMO-1"], { ...f.options,
    fetchImpl: async () => new globalThis.Response("{}", { headers: { "content-length": "300000" } }) }), /exceeds/);
  f.issue.fields.project.key = "OTHER";
  await assert.rejects(readJiraTickets(f.root, "demo", ["DEMO-1"], f.options), /configured project/);
  f.issue.fields.project.key = "DEMO"; f.issue.fields.priority.id = "9";
  await assert.rejects(readJiraTickets(f.root, "demo", ["DEMO-1"], f.options), /priority id/);
  f.issue.fields.priority.id = "2";
  for (let i = 0; i < 42; i++) f.issue.fields.description = { type: "doc", content: [f.issue.fields.description] };
  await assert.rejects(readJiraTickets(f.root, "demo", ["DEMO-1"], f.options), /nesting/);
  assert.throws(() => normalizeJiraSource({ kind: "other" }), /Invalid Jira/);
});

test("Jira import stays DRAFT until a detailed plan is provided and current inputs are checked", async t => {
  const f = fixture(t); const command = prepareProject(f);
  const plan = await command(["import-jira", "work", "--project", "demo", "--issues", "DEMO-1"]);
  assert.equal(plan.status, "DRAFT"); assert.equal(plan.tickets[0].retry_policy.max_attempts, 3);
  await assert.rejects(command(["approve", "work"]), /explicit acceptance/);
  await assert.rejects(command(["import-jira", "work", "--project", "demo", "--issues", "DEMO-1"]), /already exists/);
  const input = { goal: plan.goal, tickets: plan.tickets.map(ticket => ({ ...ticket,
    implementation_steps: ["Inspect current payment path", "Add idempotency store"],
    acceptance_criteria: ["Duplicate requests have one effect"], test_plan: { unit: ["Concurrent duplicates"] }
  })) };
  delete input.tickets[0].source;
  const file = path.join(f.root, "plan.json"); fs.writeFileSync(file, JSON.stringify(input));
  const revised = command(["revise", "work", "--plan-file", file]);
  assert.equal(revised.tickets[0].source.issue_id, "10001");
  f.issue.fields.priority.id = "9";
  await assert.rejects(command(["approve", "work"]), /inputs changed/);
  f.issue.fields.priority.id = "2";
  const approved = await command(["approve", "work"]);
  assert.equal(approved.status, "APPROVED");
  assert.equal((await command(["ready", "work"])).status, "APPROVED");
  const state = buildExecutionState(approved, f.root);
  state.status = "REVIEW_READY";
  state.tickets[0].status = "REVIEW_READY";
  state.tickets[0].verification = { content_fingerprint: "verified" };
  fs.mkdirSync(state.tickets[0].worktree, { recursive: true });
  fs.mkdirSync(path.join(f.local, "executions"), { recursive: true });
  fs.writeFileSync(path.join(f.local, "executions", "work.json"), JSON.stringify(state));
  const control = createControlPlaneCommands({ root: f.root, parseArgs, ...f.options, log: () => {},
    reviewFingerprint: () => "verified", runGit: () => { throw new Error("Do not run Git"); } });
  const release = await control.release(["request", "work", "--summary", "Review implementation", "--operation", "commit", "--message", "feat: test"]);
  assert.equal(release.tickets[0].source.issue_id, "10001");
  await control.release(["approve", "work", "--fingerprint", release.fingerprint]);
  f.issue.fields.summary = "Changed after approval";
  await assert.rejects(control.release(["apply", "work", "--fingerprint", release.fingerprint]), /inputs changed/);
  await assert.rejects(control.release(["consume", "work", "--fingerprint", release.fingerprint]), /inputs changed/);
  await assert.rejects(control.release(["request", "work", "--summary", "New review"]), /inputs changed/);
  await assert.rejects(command(["ready", "work"]), /inputs changed/);
  const execution = createExecutionCommand({ root: f.root, parseArgs, ...f.options,
    runGit: () => { throw new Error("Must not reach Git"); }, log: () => {} });
  await assert.rejects(execution(["prepare", "work"]), /inputs changed/);
  await assert.rejects(execution(["review-ready", "work", "--ticket", "jira-10001"]), /inputs changed/);
  const runner = createAgentRunnerCommand({ root: f.root, parseArgs, ...f.options, log: () => {},
    invokeAgent: () => { throw new Error("Must not reach agent"); } });
  await assert.rejects(runner(["run", "work"]), /inputs changed/);
});
