"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHistoryCommand } = require("../../tools/harness-cli/work-history");
const { summarizeMeasurement, auditTasks } = require("../../tools/harness-cli/operations-report");
const { createProviderUsageService } = require("../../tools/harness-cli/provider-usage");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-report-"));
  const save = (file, value) => { const destination = path.join(root, file); fs.mkdirSync(path.dirname(destination), { recursive: true }); fs.writeFileSync(destination, JSON.stringify(value)); };
  save(".harness/local/requests/work.json", { request_id: "work", content_fingerprint: "plan", tickets: [{ project_id: "demo", ticket_id: "feature", goal: "Feature", acceptance_criteria: ["boundary passes", "HTTP works"], test_plan: { unit: ["boundary case"] } }] });
  const state = { request_id: "work", request_fingerprint: "plan", tickets: [{ project_id: "demo", ticket_id: "feature", status: "REVIEW_READY", worktree: root,
    runner: { attempts: 2, started_at: "2026-10-02T01:00:00Z", completed_at: "2026-10-02T01:01:00Z", history: [{ status: "FAILED" }, { status: "SUCCEEDED" }] },
    verification: { content_fingerprint: "current", results: [{ command: "node test.js", status: 0, duration_ms: 100 }] } }] };
  save(".harness/local/executions/work.json", state);
  const parseArgs = args => { const positional = [], options = {}; for (let i = 0; i < args.length; i++) args[i].startsWith("--") ? options[args[i].slice(2)] = args[++i] : positional.push(args[i]); return { positional, options }; };
  let fingerprint = "current";
  const command = createHistoryCommand({ root, parseArgs, log: () => {}, reviewFingerprint: () => fingerprint });
  const run = (action, ...args) => command([action, "--project", "demo", "--request", "work", "--ticket", "feature", ...args]);
  return { root, state, save, run, stale: () => { fingerprint = "changed"; } };
}

test("reports distinguish observed usage, estimates, missing measurements and failed attempts", () => {
  const f = fixture();
  const unknown = f.run("report");
  assert.equal(unknown.observed_api_tokens, null);
  assert.equal(unknown.human_measurement.reduction_percent, null);
  assert.equal(unknown.failed_attempts, 1); assert.equal(unknown.verification_ms, 100); assert.equal(unknown.runner_elapsed_ms, 60000);
  const usage = createProviderUsageService({ root: f.root, env: {}, now: () => new Date("2026-10-02T00:00:00Z") });
  usage.record("openai", "mock", { usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } }, { project_id: "demo", request_id: "work", ticket_id: "feature" });
  usage.record("openai", "mock", { usage: { total_tokens: 999 } }, { project_id: "other", request_id: "work", ticket_id: "feature" });
  assert.equal(f.run("report").observed_api_tokens, 30);
  usage.record("openai", "mock", {}, { project_id: "demo", request_id: "work", ticket_id: "feature" });
  assert.equal(f.run("report").observed_api_tokens, null);
  assert.throws(() => usage.record("openai", "mock", {}, { project_id: "../secret", request_id: "work", ticket_id: "feature" }), /attribution/);
  assert.throws(() => f.run("report", "--project", "other"), /Unknown/);
});

test("human time requires a full measured breakdown and never substitutes unknowns with zero", () => {
  const f = fixture();
  f.run("measure", "--baseline-minutes", "100", "--requirements-minutes", "2", "--note", "Matched task, remaining time unmeasured");
  assert.equal(f.run("report").human_measurement.reduction_percent, null);
  f.run("measure", "--baseline-minutes", "100", "--requirements-minutes", "2", "--setup-minutes", "3", "--review-minutes", "10", "--recovery-minutes", "5", "--note", "Same scope, stopwatch observations");
  assert.equal(f.run("report").human_measurement.human_minutes, 20);
  assert.equal(f.run("report").human_measurement.reduction_percent, 80);
  for (const value of ["-1", "NaN", "Infinity", "true", ""]) assert.throws(() => f.run("measure", "--review-minutes", value, "--note", "observation"), /Invalid/);
  assert.throws(() => f.run("measure", "--baseline-minutes", "0", "--note", "observation"), /positive/);
  assert.throws(() => f.run("measure"), /note/);
  assert.equal(summarizeMeasurement({ baseline_minutes: 5, requirements_minutes: 2, setup_minutes: 3, review_minutes: 4, recovery_minutes: 1 }).reduction_percent, -100);
});

test("acceptance evidence binds a real passed command without creating user acceptance", () => {
  const f = fixture();
  f.run("map-check", "--criterion", "1", "--command-index", "1", "--note", "Boundary assertion checks first criterion");
  const report = f.run("report");
  assert.match(report.acceptance[0].evidence_status, /human-review-required/);
  assert.equal(report.acceptance[1].evidence_status, "unmapped-or-stale");
  assert.equal(report.review, null);
  for (const [criterion, index] of [[0, 1], [3, 1], [1, 2], [1.5, 1]]) assert.throws(() => f.run("map-check", "--criterion", String(criterion), "--command-index", String(index), "--note", "mapping"), /existing criterion/);
  f.stale();
  assert.throws(() => f.run("map-check", "--criterion", "1", "--command-index", "1", "--note", "mapping"), /Current/);
  assert.equal(f.run("report").acceptance[0].evidence_status, "unmapped-or-stale");
  assert.equal(f.run("report").content_current, false);
});

test("changed plan, failed result and non-review states cannot create acceptance mappings", () => {
  for (const mutation of [f => { f.state.request_fingerprint = "old"; }, f => { f.state.tickets[0].status = "BLOCKED"; }, f => { f.state.tickets[0].verification.results[0].status = 1; }]) {
    const f = fixture(); mutation(f); f.save(".harness/local/executions/work.json", f.state);
    assert.throws(() => f.run("map-check", "--criterion", "1", "--command-index", "1", "--note", "mapping"), /Current|passed/);
  }
  const f = fixture(); f.state.tickets[0].verification.results[0].duration_ms = undefined; f.save(".harness/local/executions/work.json", f.state);
  assert.equal(f.run("report").verification_ms, null);
  delete f.state.request_fingerprint;
  f.save(".harness/local/executions/work.json", f.state);
  f.save(".harness/local/requests/work.json", { tickets: [{ project_id: "demo", ticket_id: "feature", acceptance_criteria: ["boundary passes"] }] });
  assert.equal(f.run("report").plan_binding_current, false);
  assert.throws(() => f.run("map-check", "--criterion", "1", "--command-index", "1", "--note", "mapping"), /Current/);
});

test("task audit is read-only and never invents completion for checked or old archive tickets", () => {
  const f = fixture(), active = path.join(f.root, ".harness/tasks/active");
  fs.mkdirSync(active, { recursive: true });
  fs.writeFileSync(path.join(active, "partial.md"), "## Acceptance Criteria\n- [x] implemented\n- [ ] live rehearsal\n## Notes\n- [ ] unrelated\n");
  fs.writeFileSync(path.join(active, "checked.md"), "## Acceptance Criteria\n- [x] done\n");
  const result = auditTasks(f.root);
  assert.equal(result.tasks.find(t => t.ticket_id === "partial").pending, 1);
  assert.match(result.tasks.find(t => t.ticket_id === "checked").disposition, /review-required/);
  assert.equal(fs.existsSync(path.join(active, "checked.md")), true);
  assert.equal(fs.existsSync(path.join(f.root, ".harness/tasks/archive/checked.md")), false);
});
