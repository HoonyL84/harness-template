"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { normalizeTicketKind, normalizeDeliverables, assertArtifactPaths, verifyArtifactTicket } = require("../../tools/harness-cli/ticket-artifacts");
const { createRequestPlan, approveRequestPlan, validateRequestPlan, planFingerprint } = require("../../tools/harness-cli/request-plan");
const { createOnboardingProfile, approveOnboardingProfile, writeOnboardingProfile } = require("../../tools/harness-cli/project-onboarding");
const { inspectGitProject, emptyRegistry, writeRegistry } = require("../../tools/harness-cli/project-registry");
const { createExecutionCommand } = require("../../tools/harness-cli/execution-command");
const { assertExecutionMatchesPlan } = require("../../tools/harness-cli/project-execution");
const { createAgentRunnerCommand } = require("../../tools/harness-cli/agent-runner");
const { repositoryContentFingerprint } = require("../../tools/harness-cli/content-fingerprint");
const { createHistoryCommand } = require("../../tools/harness-cli/work-history");
const { captureFollowups, summaryInput } = require("../../tools/harness-cli/operations-followup");
const { ticketDraft } = require("../../tools/harness-cli/atlassian-payloads");
const { readJson, writeJsonAtomic } = require("../../tools/harness-cli/control-plane-state");
const criterion = "Compare scope and alternatives";
const document = "# Proposed design\n\n## Decisions\nChoose a small prototype; no product approval claimed.\n\n## Open Questions\nArt direction needs human selection.\n\n## Acceptance Review\n- [ ] " + criterion + "\n";
const parseArgs = args => { const positional = [], options = {}; for (let i = 0; i < args.length; i++) args[i].startsWith("--") ? options[args[i].slice(2)] = args[++i] : positional.push(args[i]); return { positional, options }; };
const quiet = () => {};
const runGit = (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8", timeout: 15000 });
const fingerprint = cwd => repositoryContentFingerprint(cwd, runGit);
function fixture(t, kind = "planning") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-artifact-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, "project"); fs.mkdirSync(projectRoot);
  const git = args => { const result = runGit(args, projectRoot); assert.equal(result.status, 0, result.stderr); return result.stdout.trim(); };
  git(["init", "-b", "main"]); git(["config", "user.name", "Fixture"]); git(["config", "user.email", "fixture@example.invalid"]);
  fs.writeFileSync(path.join(projectRoot, "source.js"), "module.exports = 1;\n"); git(["add", "."]); git(["commit", "-m", "test: fixture"]);
  const project = { id: "demo", path: projectRoot, stacks: [], branch: "main" };
  const diagnosis = inspectGitProject(projectRoot, runGit);
  const draft = createOnboardingProfile(project, { ...diagnosis, verify_commands: ["node source.js"] }, [], []);
  const profile = approveOnboardingProfile(draft, draft), local = path.join(root, ".harness/local");
  writeOnboardingProfile(path.join(local, "profiles/demo.json"), profile);
  const registry = emptyRegistry(); registry.projects.demo = project; writeRegistry(path.join(local, "projects.json"), registry);
  const plan = approveRequestPlan(createRequestPlan({ requestId: "plan-work", goal: "Prepare design", profiles: { demo: profile }, tickets: [{ ticket_id: "concept", project_id: "demo", ticket_kind: kind, goal: "Prepare design", deliverables: ["docs/concept.md"], acceptance_criteria: [criterion], implementation_steps: ["Compare options"] }] }));
  writeJsonAtomic(path.join(local, "requests/plan-work.json"), plan);
  let commandCalls = 0;
  const options = { root, parseArgs, reviewFingerprint: fingerprint, runGit, runCommand: () => { commandCalls++; return { status: 0 }; }, tokenizeCommand: value => value.split(" "), log: quiet };
  const execution = createExecutionCommand(options), state = execution(["prepare", "plan-work"]); assert.equal(state.status, "PREPARED");
  const ticket = state.tickets[0];
  const saveDocument = (content = document) => { fs.mkdirSync(path.join(ticket.worktree, "docs"), { recursive: true }); fs.writeFileSync(path.join(ticket.worktree, "docs/concept.md"), content); };
  return { root, local, plan, ticket, execution, options, saveDocument, commandCalls: () => commandCalls };
}
function patch(content = document, file = "docs/concept.md") { const lines = content.trimEnd().split("\n"); return "diff --git a/" + file + " b/" + file + "\nnew file mode 100644\n--- /dev/null\n+++ b/" + file + "\n@@ -0,0 +1," + lines.length + " @@\n" + lines.map(line => "+" + line).join("\n") + "\n"; }

test("kinds and deliverables are approval-bound and legacy compatible", () => {
  assert.equal(normalizeTicketKind(), "development");
  for (const kind of ["docs", null, "Planning", 1]) assert.throws(() => normalizeTicketKind(kind), /kind/);
  for (const file of ["../a.md", "docs/../a.md", "docs\\a.md", "docs/a.js", "/docs/a.md", "docs/a.md:stream", ".harness/a.md", "docs/.hidden.md", "docs/node_modules/a.md", "docs/NUL.md", "docs//a.md"]) assert.throws(() => normalizeDeliverables([file], "planning"), /safe/);
  assert.throws(() => normalizeDeliverables([], "design"), /explicit/);
  assert.throws(() => normalizeDeliverables(["docs/A.md", "docs/a.md"], "planning"), /Duplicate/);
  assert.throws(() => assertArtifactPaths({ ticket_kind: "planning", deliverables: ["docs/a.md"] }, ["source.js"]), /Full verification/);
  const profiles = { demo: { status: "APPROVED", content_fingerprint: "profile", verify_commands: ["npm test"] } };
  const legacy = createRequestPlan({ requestId: "legacy", goal: "Implement", projectIds: ["demo"], profiles });
  assert.equal(legacy.tickets[0].ticket_kind, "development"); assert.deepEqual(legacy.tickets[0].verification, ["npm test"]);
  delete legacy.tickets[0].ticket_kind; delete legacy.tickets[0].deliverables; legacy.content_fingerprint = planFingerprint(legacy); assert.equal(validateRequestPlan(approveRequestPlan(legacy)).tickets[0].ticket_kind, undefined);
  const input = { ticket_id: "design", project_id: "demo", goal: "Design", ticket_kind: "design", deliverables: ["docs/design.md"], acceptance_criteria: [criterion], implementation_steps: ["Compare"] };
  assert.throws(() => createRequestPlan({ requestId: "bad", goal: "Design", profiles, tickets: [{ ...input, acceptance_criteria: [] }] }), /explicit/);
  const plan = approveRequestPlan(createRequestPlan({ requestId: "valid", goal: "Design", profiles, tickets: [input] })); assert.deepEqual(plan.tickets[0].verification, []);
  const changed = JSON.parse(JSON.stringify(plan)); changed.tickets[0].ticket_kind = "development"; assert.throws(() => validateRequestPlan(changed), /fingerprint/);
});

test("manual design review checks artifacts without fake test pass and records human acceptance", t => {
  const f = fixture(t, "design"); f.saveDocument(); const ready = f.execution(["review-ready", "plan-work", "--ticket", "concept"]), ticket = ready.tickets[0];
  assert.equal(ready.status, "REVIEW_READY"); assert.equal(f.commandCalls(), 0); assert.equal(ticket.verification.mode, "artifact"); assert.deepEqual(ticket.verification.results, []);
  assert.equal(ticket.verification.acceptance_checklist[0].status, "pending-user-review");
  const history = createHistoryCommand(f.options), scope = ["--project", "demo", "--request", "plan-work", "--ticket", "concept"];
  const report = history(["report", ...scope]); assert.equal(report.ticket_kind, "design"); assert.equal(report.review, null); assert.match(report.acceptance[0].evidence_status, /human-review-required/);
  const review = history(["review", ...scope, "--fingerprint", ticket.verification.content_fingerprint, "--result", "accepted", "--reason", "Fixture decision, not actual user acceptance"]); assert.equal(review.status, "accepted");
  assert.equal(history(["list", "--ticket-kind", "design"])[0].ticket_kind, "design");
  writeJsonAtomic(path.join(f.local, "atlassian.json"), {}); const result = captureFollowups(f.root).entries.find(entry => entry.kind === "confluence-result");
  assert.equal(result.fact.status, "COMPLETED"); assert.match(summaryInput(result).summary, /Open Questions/);
  f.saveDocument(document + "\nChanged after review\n"); assert.throws(() => history(["review", ...scope, "--fingerprint", ticket.verification.content_fingerprint, "--result", "accepted", "--reason", "stale"]), /(?:content|evidence) changed/);
  assert.equal(history(["report", ...scope]).review, null);
});

test("missing sections, excessive size and source changes fail closed", t => {
  const f = fixture(t); f.saveDocument(); const check = () => verifyArtifactTicket(f.ticket, runGit);
  for (const content of ["", document.replace("## Decisions", "## Other"), document.replace(criterion, "wrong criterion"), document.replace("Art direction needs human selection.", ""), document + "x".repeat(16000), document + "\0"]) { f.saveDocument(content); assert.throws(check); }
  f.saveDocument(); assert.equal(check().mode, "artifact"); fs.writeFileSync(path.join(f.ticket.worktree, "source.js"), "module.exports = 2;\n");
  assert.throws(() => f.execution(["review-ready", "plan-work", "--ticket", "concept"]), /development ticket/);
  assert.equal(readJson(path.join(f.local, "executions/plan-work.json"), null).tickets[0].status, "PREPARED");
  const changed = readJson(path.join(f.local, "executions/plan-work.json"), null); delete changed.tickets[0].ticket_kind; assert.throws(() => assertExecutionMatchesPlan(changed, f.plan, f.root), /kind\/deliverables/);
});

test("artifact verifier rejects symlink or junction escape", t => {
  const f = fixture(t), external = path.join(f.root, "external"); fs.mkdirSync(external); fs.writeFileSync(path.join(external, "concept.md"), document);
  fs.symlinkSync(external, path.join(f.ticket.worktree, "docs"), process.platform === "win32" ? "junction" : "dir"); assert.throws(() => verifyArtifactTicket(f.ticket, runGit), /symbolic|junction|unapproved/);
});

test("API planning runner produces bounded Markdown and keeps notification and approval gates", async t => {
  const f = fixture(t); let calls = 0; const notifications = [];
  const runner = createAgentRunnerCommand({ ...f.options, invokeAgent: async prompt => { calls++; assert.match(prompt, /TICKET_KIND: planning/); assert.match(prompt, /Do not implement code/); return patch(); }, notify: async (...values) => { notifications.push(values); return { sent: 1 }; } });
  const ready = await runner(["run", "plan-work"]); assert.equal(ready.status, "REVIEW_READY"); assert.equal(calls, 1); assert.equal(f.commandCalls(), 0); assert.equal(notifications.length, 1);
  assert.equal(ready.tickets[0].verification.mode, "artifact"); assert.match(fs.readFileSync(path.join(f.ticket.worktree, "docs/concept.md"), "utf8"), /Open Questions/);
  assert.equal(runGit(["rev-parse", "HEAD"], f.ticket.worktree).stdout.trim(), f.ticket.base_commit);
  assert.equal(readJson(path.join(f.local, "history/ledger.json"), { events: [] }).events.some(e => e.kind === "USER_REVIEW"), false);
});

test("API artifact ticket cannot apply code or out-of-scope Markdown", async t => {
  for (const file of ["docs/unapproved.md", "extra.js"]) {
    const f = fixture(t), runner = createAgentRunnerCommand({ ...f.options, invokeAgent: async () => patch(document, file), notify: async () => ({ sent: 1 }) });
    const state = await runner(["run", "plan-work"]); assert.equal(state.status, "BLOCKED"); assert.match(state.tickets[0].error, /development ticket/); assert.equal(fs.existsSync(path.join(f.ticket.worktree, file)), false);
  }
});

test("Jira kind is structured metadata and a filterable label; work types stay unchanged", () => {
  const config = { jira_projects: { demo: "GAME" }, jira_issue_types: { demo: "10048" } }, ticket = { ticket_id: "concept", project_id: "demo", ticket_kind: "planning", goal: "Choose concept", deliverables: ["docs/concept.md"] };
  const payload = ticketDraft(config, { request_id: "work", status: "DRAFT" }, ticket).build("marker"); assert.equal(payload.fields.issuetype.id, "10048"); assert.match(payload.fields.summary, /Choose concept$/);
  assert.deepEqual(payload.fields.labels, ["marker", "harness-kind-planning"]); assert.equal(JSON.parse(payload.fields.description.content[0].content[0].text).ticket_kind, "planning");
});


test("stored artifact tampering cannot be accepted or published against unchanged files", t => {
  const { assertFollowup, bindFollowup } = require("../../tools/harness-cli/operations-followup");
  const f = fixture(t); f.saveDocument(); const ready = f.execution(["review-ready", "plan-work", "--ticket", "concept"]);
  const history = createHistoryCommand(f.options), scope = ["--project", "demo", "--request", "plan-work", "--ticket", "concept"];
  writeJsonAtomic(path.join(f.local, "atlassian.json"), {});
  const entry = captureFollowups(f.root).entries.find(e => e.kind === "confluence-result"), binding = bindFollowup(f.root, entry.id, {});
  assert.doesNotThrow(() => assertFollowup(f.root, binding, {}, fingerprint));
  const changed = JSON.parse(JSON.stringify(ready)); changed.tickets[0].verification.artifacts[0].content += "\nUnreviewed injected text\n";
  writeJsonAtomic(path.join(f.local, "executions/plan-work.json"), changed);
  assert.throws(() => history(["review", ...scope, "--fingerprint", ready.tickets[0].verification.content_fingerprint, "--result", "accepted", "--reason", "snapshot tampered"]), /evidence changed/);
  assert.equal(history(["report", ...scope]).content_current, false);
  captureFollowups(f.root); const newEntry = captureFollowups(f.root).entries.find(e => e.kind === "confluence-result" && e.status !== "SUPERSEDED");
  assert.throws(() => assertFollowup(f.root, bindFollowup(f.root, newEntry.id, {}), {}, fingerprint), /evidence changed/);
});

test("approved context refs are enforced in manual review, CLI preview and before any model retry", async t => {
  const { createProjectCommand } = require("../../tools/harness-cli/project-command");
  const f = fixture(t); f.saveDocument();
  const changed = globalThis.structuredClone(f.plan); changed.status = "DRAFT"; changed.approved_at = null;
  changed.tickets[0].context_refs = [{ path: "docs/missing-input.md" }]; changed.content_fingerprint = planFingerprint(changed);
  const approved = approveRequestPlan(changed); writeJsonAtomic(path.join(f.local, "requests/plan-work.json"), approved);
  const state = readJson(path.join(f.local, "executions/plan-work.json"), null);
  state.request_fingerprint = approved.content_fingerprint; state.tickets[0].context_refs = approved.tickets[0].context_refs;
  writeJsonAtomic(path.join(f.local, "executions/plan-work.json"), state);
  assert.throws(() => f.execution(["review-ready", "plan-work", "--ticket", "concept"]), /Required context missing/);
  assert.equal(readJson(path.join(f.local, "executions/plan-work.json"), null).tickets[0].status, "PREPARED");
  const preview = createProjectCommand({ ...f.options, parseArgs: args => {
    const positional = [], options = {}; for (let i = 0; i < args.length; i++) {
      if (args[i].startsWith("--")) options[args[i].slice(2)] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
      else positional.push(args[i]);
    } return { positional, options };
  } });
  assert.throws(() => preview(["context", "demo", "--bundle", "--request", "plan-work", "--ticket", "concept"]), /Required context missing/);
  assert.throws(() => preview(["context", "demo", "--bundle", "--request", "plan-work"]), /both --request and --ticket/);
  let calls = 0, notices = 0;
  const runner = createAgentRunnerCommand({ ...f.options, invokeAgent: async () => { calls++; return patch(); }, notify: async () => { notices++; return { sent: 1 }; } });
  const result = await runner(["run", "plan-work"]);
  assert.equal(result.status, "BLOCKED"); assert.equal(calls, 0); assert.equal(result.tickets[0].runner.attempts, 1); assert.equal(notices, 1);
  assert.match(result.tickets[0].error, /Required context missing/);
});
