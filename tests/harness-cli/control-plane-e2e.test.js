"use strict";
const assert = require("node:assert/strict"); const crypto = require("node:crypto"); const fs = require("node:fs"); const os = require("node:os"); const path = require("node:path"); const test = require("node:test");
const { createControlPlaneCommands } = require("../../tools/harness-cli/control-plane-command");
function parseArgs(args) { const positional = []; const options = {}; for (let i = 0; i < args.length; i += 1) { if (!args[i].startsWith("--")) positional.push(args[i]); else { const key = args[i].slice(2); options[key] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true; } } return { positional, options }; }
test("two-project control plane gates release, deduplicates alerts, and exports verified evidence", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-control-e2e-")); const local = path.join(root, ".harness", "local"); const executions = path.join(local, "executions"); fs.mkdirSync(executions, { recursive: true });
  const fingerprint = (worktree) => crypto.createHash("sha256").update(fs.readFileSync(path.join(worktree, "source.txt"))).digest("hex");
  const tickets = ["ads", "payments"].map((project) => { const worktree = path.join(root, project); fs.mkdirSync(worktree); fs.writeFileSync(path.join(worktree, "source.txt"), project); return { ticket_id: `${project}-ticket`, project_id: project, branch: `codex/${project}`, base_commit: "abc", worktree, status: "REVIEW_READY", verification: { summary: "tests passed", content_fingerprint: fingerprint(worktree) } }; });
  fs.writeFileSync(path.join(executions, "multi-work.json"), JSON.stringify({ execution_id: "multi-work-1", request_id: "multi-work", status: "REVIEW_READY", tickets }));
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
