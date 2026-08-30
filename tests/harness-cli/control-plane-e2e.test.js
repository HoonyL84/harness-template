"use strict";
const assert = require("node:assert/strict"); const crypto = require("node:crypto"); const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path"); const test = require("node:test");
const { createControlPlaneCommands } = require("../../tools/harness-cli/control-plane-command");
const { buildExecutionState } = require("../../tools/harness-cli/project-execution");
const { approveRequestPlan, createRequestPlan } = require("../../tools/harness-cli/request-plan");
function parseArgs(args) { const positional = []; const options = {}; for (let i = 0; i < args.length; i += 1) { if (!args[i].startsWith("--")) positional.push(args[i]); else { const key = args[i].slice(2); options[key] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true; } } return { positional, options }; }
function reviewReadyFixture(root, requestId, ticketInputs, fingerprint) {
  const local = path.join(root, ".harness", "local");
  const profiles = Object.fromEntries(ticketInputs.map((ticket) => [ticket.project_id, { status: "APPROVED", content_fingerprint: `${ticket.project_id}-profile`, verify_commands: ["npm test"] }]));
  const plan = approveRequestPlan(createRequestPlan({ requestId, goal: "Approved work", tickets: ticketInputs, profiles }));
  const state = buildExecutionState(plan, root);
  for (const ticket of state.tickets) {
    fs.mkdirSync(ticket.worktree, { recursive: true });
    fs.writeFileSync(path.join(ticket.worktree, "source.txt"), ticket.project_id === "demo" ? "approved" : ticket.project_id);
    ticket.base_commit = "abc";
    ticket.status = "REVIEW_READY";
    ticket.verification = { summary: "tests passed", content_fingerprint: fingerprint(ticket.worktree) };
  }
  state.status = "REVIEW_READY";
  fs.mkdirSync(path.join(local, "requests"), { recursive: true });
  fs.mkdirSync(path.join(local, "executions"), { recursive: true });
  fs.writeFileSync(path.join(local, "requests", `${requestId}.json`), JSON.stringify(plan));
  fs.writeFileSync(path.join(local, "executions", `${requestId}.json`), JSON.stringify(state));
  return state.tickets;
}
test("two-project control plane gates release, deduplicates alerts, and exports verified evidence", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-control-e2e-")); const local = path.join(root, ".harness", "local"); const executions = path.join(local, "executions"); fs.mkdirSync(executions, { recursive: true });
  const fingerprint = (worktree) => crypto.createHash("sha256").update(fs.readFileSync(path.join(worktree, "source.txt"))).digest("hex");
  const tickets = reviewReadyFixture(root, "multi-work", ["ads", "payments"].map((project) => ({ ticket_id: `${project}-ticket`, project_id: project, goal: `${project} work`, verification: ["npm test"] })), fingerprint);
  fs.writeFileSync(path.join(local, "projects.json"), JSON.stringify({ schema_version: "1.0", projects: { ads: { id: "ads", path: tickets[0].worktree }, payments: { id: "payments", path: tickets[1].worktree } } }));
  const notices = []; const logs = []; const commands = createControlPlaneCommands({ root, parseArgs, reviewFingerprint: fingerprint, runGit: () => ({ status: 0, stdout: "", stderr: "" }), notify: async (...values) => { notices.push(values); return { configured: ["test"], sent: 1 }; }, log: (value) => logs.push(value) });
  const pending = commands.release(["request", "multi-work", "--summary", "all checks passed"]); assert.equal(pending.tickets.length, 2);
  assert.throws(() => commands.release(["consume", "multi-work", "--fingerprint", pending.fingerprint]), /unconsumed/);
  commands.release(["approve", "multi-work", "--fingerprint", pending.fingerprint]);
  fs.writeFileSync(path.join(tickets[0].worktree, "source.txt"), "changed after approval");
  assert.throws(() => commands.release(["consume", "multi-work", "--fingerprint", pending.fingerprint]), /changed after release approval/);
  fs.writeFileSync(path.join(tickets[0].worktree, "source.txt"), "ads");
  commands.release(["consume", "multi-work", "--fingerprint", pending.fingerprint]); assert.throws(() => commands.release(["consume", "multi-work", "--fingerprint", pending.fingerprint]), /unconsumed/);
  const evidenceFile = path.join(root, "evidence.json"); fs.writeFileSync(evidenceFile, JSON.stringify({ project_id: "ads", ticket_id: "ads-ticket", title: "Ad cache", status: "VERIFIED", visibility: "public", commit: "abc1234", technologies: ["Redis"] })); commands.evidence(["add", "--file", evidenceFile]); assert.match(commands.evidence(["export"]), /abc1234/);
  await commands.dashboard([]); await commands.dashboard([]); assert.equal(notices.length, 1);
});

test("failed notifications remain retryable", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-control-notify-"));
  let attempts = 0;
  const commands = createControlPlaneCommands({ root, parseArgs, reviewFingerprint: () => "unused", runGit: () => ({ status: 0 }), notify: async () => { attempts += 1; return { configured: ["test"], sent: 0 }; }, log: () => {} });
  await commands.dashboard([]);
  await commands.dashboard([]);
  assert.equal(attempts, 2);
});

test("managed release executes only the fingerprint-bound one-time Git operation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-managed-release-"));
  const local = path.join(root, ".harness", "local");
  const fingerprint = () => "approved-content";
  reviewReadyFixture(root, "managed", [{ ticket_id: "safe-change", project_id: "demo", goal: "Safe change", verification: ["npm test"] }], fingerprint);
  fs.writeFileSync(path.join(local, "projects.json"), JSON.stringify({ schema_version: "1.0", projects: { demo: { id: "demo", path: path.join(root, "demo"), stacks: ["node"] } } }));
  const mutations = [];
  const runGit = (args) => {
    if (["add", "commit", "push", "merge"].includes(args[0])) mutations.push(args);
    if (args[0] === "branch") return { status: 0, stdout: "codex/managed/safe-change\n", stderr: "" };
    if (args[0] === "status") return { status: 0, stdout: " M source.txt\n", stderr: "" };
    if (args[0] === "rev-parse") return { status: 0, stdout: "abcdef123456\n", stderr: "" };
    return { status: 0, stdout: "", stderr: "" };
  };
  const commands = createControlPlaneCommands({ root, parseArgs, reviewFingerprint: fingerprint, runGit, notify: async () => ({ sent: 0 }), log: () => {} });
  const pending = commands.release(["request", "managed", "--approval", "managed-commit", "--summary", "reviewed", "--operation", "commit", "--message", "feat: safe change"]);
  assert.equal(pending.approval_id, "managed-commit");
  assert.throws(() => commands.release(["apply", "managed-commit", "--fingerprint", pending.fingerprint]), /unconsumed release approval/);
  assert.deepEqual(mutations, []);
  commands.release(["approve", "managed-commit", "--fingerprint", pending.fingerprint]);
  const applied = commands.release(["apply", "managed-commit", "--fingerprint", pending.fingerprint]);
  assert.equal(applied.status, "APPLIED");
  assert.equal(applied.result[0].commit, "abcdef123456");
  const execution = JSON.parse(fs.readFileSync(path.join(local, "executions", "managed.json")));
  assert.equal(execution.tickets[0].committed_sha, "abcdef123456");
  assert.equal(execution.tickets[0].release_history[0].approval_id, "managed-commit");
  const evidence = JSON.parse(fs.readFileSync(path.join(local, "career", "ledger.json")));
  assert.equal(evidence[0].status, "DRAFT");
  assert.equal(evidence[0].commit, "abcdef123456");
  assert.deepEqual(mutations, [["add", "--all"], ["commit", "-m", "feat: safe change"]]);
  assert.throws(() => commands.release(["apply", "managed-commit", "--fingerprint", pending.fingerprint]), /unconsumed release approval/);
  assert.equal(mutations.length, 2);
});
