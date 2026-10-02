"use strict";
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createProjectCommand } = require("../../tools/harness-cli/project-command");
const { createRequestCommand } = require("../../tools/harness-cli/request-command");
const { createExecutionCommand } = require("../../tools/harness-cli/execution-command");
const { createAgentRunnerCommand } = require("../../tools/harness-cli/agent-runner");
const { createControlPlaneCommands } = require("../../tools/harness-cli/control-plane-command");
const { createHistoryCommand } = require("../../tools/harness-cli/work-history");
const { repositoryContentFingerprint } = require("../../tools/harness-cli/content-fingerprint");

const parseArgs = args => { const positional = [], options = {}; for (let i = 0; i < args.length; i++) { if (!args[i].startsWith("--")) positional.push(args[i]); else options[args[i].slice(2)] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true; } return { positional, options }; };
const runGit = (args, cwd) => spawnSync("git", args, { cwd, encoding: "utf8", timeout: 15000 });
const fingerprint = cwd => repositoryContentFingerprint(cwd, runGit);
const quiet = () => {};

/** Owned temporary repositories and actual Git/HTTP checks; AI generation and human decisions are fixtures. */
async function runRehearsal(root, { env = {}, resume = false, onDraft = async () => {}, onPrepared = async () => {}, onReviewed = async () => {} } = {}) {
  const requestId = "harness-rehearsal";
  const ids = ["ad-server", "payments-server"];
  const project = createProjectCommand({ root, parseArgs, runGit, log: quiet });
  const input = { goal: "HARNESS REHEARSAL - synthetic local Git and HTTP workflow", tickets: [] };
  const existingPlan = path.join(root, ".harness/local/requests", `${requestId}.json`);
  if (resume) Object.assign(input, JSON.parse(fs.readFileSync(existingPlan, "utf8")));
  for (const id of ids) {
    if (resume) continue;
    const original = path.join(root, "originals", id); fs.mkdirSync(original, { recursive: true });
    const git = args => { const result = runGit(args, original); assert.equal(result.status, 0, result.stderr || result.error?.message); return result.stdout.trim(); };
    git(["init", "-b", "main", "--quiet"]); git(["config", "user.name", "Harness Rehearsal"]); git(["config", "user.email", "fixture@example.invalid"]);
    fs.writeFileSync(path.join(original, "source.js"), "module.exports = 0;\n");
    fs.writeFileSync(path.join(original, "package.json"), JSON.stringify({ private: true, scripts: { test: "node verify.js" } }));
    fs.writeFileSync(path.join(original, "README.md"), "Synthetic rehearsal, no production data.\n");
    fs.writeFileSync(path.join(original, "verify.js"), "const assert=require('node:assert/strict'); assert.equal(require('./source'),1); const s=require('node:http').createServer((_q,r)=>r.end('ready')); s.listen(0,'127.0.0.1',async()=>{try {const r=await fetch('http://127.0.0.1:'+s.address().port);assert.equal(await r.text(),'ready');}catch(e){process.stderr.write(e.message);process.exitCode=1;}finally{s.close();}});\n");
    git(["add", "."]); git(["commit", "-m", "fixture: initial"]);
    project(["add", id, "--path", original]); project(["onboard", id]); project(["onboard", id, "--approve"]);
    input.tickets.push({ project_id: id, ticket_id: `${id}-test`, goal: `HARNESS REHEARSAL - ${id} synthetic HTTP ready`, scope: ["source.js"], exclusions: ["production data, paid API, external Git push"],
      acceptance_criteria: ["source returns 1 and HTTP responds ready"], implementation_steps: ["Change source from 0 to 1"], test_plan: { unit: ["assert exported value"], integration: ["real ephemeral HTTP response"] }, verification: ["node verify.js"] });
  }
  const file = path.join(root, "plan.json"); fs.writeFileSync(file, JSON.stringify(input));
  const request = createRequestCommand({ root, parseArgs, log: quiet, env });
  if (!resume) {
    request(["create", requestId, "--plan-file", file]);
    await onDraft({ root, requestId, tickets: input.tickets });
    await request(["approve", requestId]);
  }
  const commandOptions = { root, parseArgs, reviewFingerprint: fingerprint, runGit, tokenizeCommand: value => value.split(" "), log: quiet, env,
    runCommand: (command, args, options) => spawnSync(command, args, { cwd: options.cwd, encoding: "utf8", timeout: 15000 }) };
  const execution = createExecutionCommand(commandOptions);
  if (!resume) await execution(["prepare", requestId]);
  await onPrepared({ root, requestId, tickets: input.tickets });
  const attempts = {}, notifications = [];
  const runner = createAgentRunnerCommand({ ...commandOptions, notify: async (...values) => { notifications.push(values); return { sent: 1 }; },
    invokeAgent: async (prompt, ticket) => {
      attempts[ticket.ticket_id] = (attempts[ticket.ticket_id] || 0) + 1;
      const value = ticket.project_id === "ad-server" && attempts[ticket.ticket_id] === 1 ? 2 : 1;
      const patch = `diff --git a/source.js b/source.js\n--- a/source.js\n+++ b/source.js\n@@ -1 +1 @@\n-module.exports = 0;\n+module.exports = ${value};\n`;
      if (prompt.includes("REPAIR_CONTRACT")) return '```repair\n{"hypothesis":"exported boundary value incorrect","evidence":"assertion expected 1","minimal_test":"node verify.js"}\n```\n```diff\n' + patch + "```";
      return patch;
    } });
  const ready = await runner(["run", requestId]); assert.equal(ready.status, "REVIEW_READY");
  assert.equal(attempts["ad-server-test"], 2); assert.equal(notifications.length, 2);
  const history = createHistoryCommand({ root, parseArgs, log: quiet, reviewFingerprint: fingerprint });
  for (const ticket of ready.tickets) {
    const scope = ["--project", ticket.project_id, "--request", requestId, "--ticket", ticket.ticket_id];
    history(["map-check", ...scope, "--criterion", "1", "--command-index", "1", "--note", "Synthetic assertion and real HTTP request verify this criterion"]);
    history(["review", ...scope, "--fingerprint", ticket.verification.content_fingerprint, "--result", "accepted", "--reason", "FIXTURE decision, not a real user's product acceptance"]);
  }
  const control = createControlPlaneCommands({ ...commandOptions, notify: async () => ({ sent: 1 }) });
  const pending = await control.release(["request", requestId, "--approval", "rehearsal-commit", "--operation", "commit", "--summary", "Synthetic local-only release", "--message", "test: synthetic rehearsal"]);
  await control.release(["approve", pending.approval_id, "--fingerprint", pending.fingerprint]);
  const applied = await control.release(["apply", pending.approval_id, "--fingerprint", pending.fingerprint]); assert.equal(applied.status, "APPLIED");
  const heads = ready.tickets.map(ticket => runGit(["rev-parse", "HEAD"], ticket.worktree).stdout);
  await assert.rejects(async () => control.release(["apply", pending.approval_id, "--fingerprint", pending.fingerprint]), /unconsumed|changed after release approval/);
  assert.deepEqual(ready.tickets.map(ticket => runGit(["rev-parse", "HEAD"], ticket.worktree).stdout), heads);
  await onReviewed({ root, requestId, tickets: input.tickets, ready });
  const reports = input.tickets.map(ticket => history(["report", "--project", ticket.project_id, "--request", requestId, "--ticket", ticket.ticket_id]));
  for (const id of ids) assert.equal(fs.readFileSync(path.join(root, "originals", id, "source.js"), "utf8"), "module.exports = 0;\n");
  return { root, request_id: requestId, actual: ["Git worktrees", "node assertions", "HTTP start/fetch/close", "managed local commits", "one-use approval"],
    fixture: ["AI responses", "human review/approval decisions", "notification transport"], attempts, reports };
}

module.exports = { fingerprint, parseArgs, runGit, runRehearsal };
