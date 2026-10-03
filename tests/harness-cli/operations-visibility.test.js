"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createControlPlaneCommands } = require("../../tools/harness-cli/control-plane-command");
const { createProviderUsageService } = require("../../tools/harness-cli/provider-usage");
const { auditTasks } = require("../../tools/harness-cli/operations-report");
const { recoveryAdvice } = require("../../tools/harness-cli/publication-recovery");
const { collectHistory } = require("../../tools/harness-cli/work-history");
const now = () => new Date("2026-10-03T00:00:00Z");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-visibility-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const save = (file, value) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value)); };
  return { root, save };
}
function parseArgs(args) { return { positional: [], options: Object.fromEntries(args.map(arg => [arg.slice(2), true])) }; }
function pricing(f, entry = {}) {
  f.save(".harness/local/pricing.json", { schema_version: "1.0", month: "2026-10", models: { openai: { mock: { source: "https://openai.com/api/pricing/", as_of: "2026-10-03", input_per_million: 1, output_per_million: 2, cached_input_per_million: 0.1, ...entry } } } });
}
test("dashboard is local and read-only by default, separates dirty/unknown and config from health", async t => {
  const f = fixture(t); f.save(".harness/local/projects.json", { schema_version: "1.0", projects: { a: { path: f.root }, b: { path: f.root + "/missing" } } });
  let notified = 0, fetched = 0;
  const c = createControlPlaneCommands({ root: f.root, parseArgs, reviewFingerprint: () => "x", runGit: () => ({ status: 0, stdout: " M x\0" }), notify: async () => { notified++; }, fetchImpl: async () => { fetched++; }, env: { TELEGRAM_BOT_TOKEN: "private", TELEGRAM_CHAT_ID: "1" }, log: () => {} });
  const r = await c.dashboard([]);
  assert.equal(notified, 0); assert.equal(fetched, 0);
  assert.equal(r.overview.projects[0].git_state, "dirty"); assert.equal(r.overview.projects[1].git_state, "unknown");
  assert.equal(r.overview.connections.telegram.status, "not-checked");
  assert.equal(JSON.stringify(r).includes("private"), false);
  assert.equal(fs.existsSync(path.join(f.root, ".harness/local/notifications")), false);
});
test("optional connection diagnosis uses GET only, redacts failures and leaves offline untested", async t => {
  const f = fixture(t); const calls = [];
  const base = { root: f.root, parseArgs, reviewFingerprint: () => "x", runGit: () => ({ status: 1 }), notify: async () => { throw Error("no notification"); }, log: () => {}, env: { TELEGRAM_BOT_TOKEN: "private", TELEGRAM_CHAT_ID: "1", SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/secret" }, fetchImpl: async (url, opts) => { calls.push(opts.method); throw Error(url); } };
  const r = await createControlPlaneCommands(base).dashboard(["--check-connections", "--json"]);
  assert.deepEqual(calls, ["GET"]); assert.equal(r.overview.connections.telegram.status, "unreachable");
  assert.equal(r.overview.connections.slack.status, "not-supported-read-only"); assert.equal(JSON.stringify(r).includes("private"), false);
  await createControlPlaneCommands({ ...base, env: { ...base.env, HARNESS_OFFLINE: "true" } }).dashboard(["--check-connections"]);
  assert.equal(calls.length, 1);
});
test("review waiting tickets retain unmet conditions and remain searchable, never auto archive", t => {
  const f = fixture(t); f.save(".harness/tasks/review/old.md", "## Acceptance Criteria\n- [x] code tested\n## Operational Review\n- [ ] user acceptance\n");
  const r = auditTasks(f.root).tasks[0]; assert.equal(r.state, "review"); assert.deepEqual(r.remaining_conditions, ["user acceptance"]); assert.match(r.disposition, /operational-review/);
  assert.ok(collectHistory(f.root).some(e => e.ticket_id === "old" && e.status === "REVIEW"));
  assert.equal(fs.existsSync(path.join(f.root, ".harness/tasks/archive/old.md")), false);
});
test("recovery advice never retries uncertain writes or grants publishing approval", () => {
  const pending = recoveryAdvice({ id: "safe-id", status: "PENDING" }); assert.match(pending.commands[0], /preview/);
  const rejected = recoveryAdvice({ id: "safe-id", status: "REJECTED" }); assert.match(rejected.commands[0], /retry-rejected safe-id --approve safe-id/);
  for (const status of ["SENDING", "NEEDS_RECONCILIATION"]) { const r = recoveryAdvice({ id: "safe-id", status }); assert.match(r.commands[0], /reconcile/); assert.equal(r.commands.some(c => /retry-rejected|sync --approve/.test(c)), false); }
  assert.equal(recoveryAdvice({ id: "x; rm", status: "REJECTED" }).commands.length, 0);
});
test("cost is opt-in and never substitutes account balance; cached input is not double charged", t => {
  const f = fixture(t); pricing(f); const s = createProviderUsageService({ root: f.root, now });
  s.record("openai", "mock", { usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, prompt_tokens_details: { cached_tokens: 20 } } });
  assert.equal(s.status().providers[0].estimated_cost, undefined);
  const cost = s.status({ cost: true }).providers[0].estimated_cost;
  assert.equal(cost.status, "estimated"); assert.equal(cost.usd, 0.000102); assert.equal(cost.models[0].source, "https://openai.com/api/pricing/");
  assert.equal(s.status({ cost: true }).providers[0].remote_account_remaining.status, "unknown");
});
test("missing prices, incomplete usage, legacy usage, stale/future rates and partial model coverage stay unknown", t => {
  const f = fixture(t); const s = createProviderUsageService({ root: f.root, now });
  s.record("openai", "mock", {}); assert.equal(s.status({ cost: true }).providers[0].estimated_cost.status, "unknown");
  pricing(f); assert.equal(s.status({ cost: true }).providers[0].estimated_cost.status, "unknown");
  const fresh = fixture(t), valid = createProviderUsageService({ root: fresh.root, now }); valid.record("openai", "mock", { usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } });
  for (const date of ["2020-01-01", "2026-10-04"]) { pricing(fresh, { as_of: date }); assert.equal(valid.status({ cost: true }).providers[0].estimated_cost.status, "unknown"); }
  pricing(fresh); valid.record("openai", "other", { usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 } }); assert.equal(valid.status({ cost: true }).providers[0].estimated_cost.usd, null);
  const legacy = fixture(t); legacy.save("observability/provider-usage/usage.json", { months: { "2026-10": { providers: { openai: { requests: 1, total_tokens: 3, models: { mock: 3 } } } } } }); pricing(legacy);
  assert.equal(createProviderUsageService({ root: legacy.root, now }).status({ cost: true }).providers[0].estimated_cost.status, "unknown");
});
test("malformed rates fail visibly; unsupported Anthropic cache writes and inconsistent totals stay unknown", t => {
  const f = fixture(t); const s = createProviderUsageService({ root: f.root, now }); pricing(f, { input_per_million: -1 }); assert.throws(() => s.status({ cost: true }), /pricing/);
  pricing(f); s.record("openai", "mock", { usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 99 } }); assert.equal(s.status({ cost: true }).providers[0].estimated_cost.status, "unknown");
  s.record("anthropic", "mock", { usage: { input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 0 } }); assert.equal(s.status({ cost: true }).providers[1].estimated_cost.status, "unknown");
});


test("Atlassian recovery command is read-only, redacts payload and rejects missing entries", async t => {
  const f = fixture(t), outbox = ".harness/local/atlassian/outbox.json";
  f.save(outbox, { entries: [{ id: "test-id", status: "REJECTED", payload: { secret: "private-content" } }] });
  const before = fs.readFileSync(path.join(f.root, outbox), "utf8"); let calls = 0;
  const { createAtlassianCommand } = require("../../tools/harness-cli/atlassian-command");
  const command = createAtlassianCommand({ root: f.root, parseArgs: args => ({ positional: args, options: {} }), log: () => {}, env: {}, fetchImpl: async () => { calls++; throw Error("no remote"); } });
  const report = await command(["recovery", "test-id"]);
  assert.equal(JSON.stringify(report).includes("private-content"), false);
  assert.match(JSON.stringify(report), /retry-rejected/);
  await assert.rejects(command(["recovery", "missing"]), /Unknown/);
  assert.equal(calls, 0); assert.equal(fs.readFileSync(path.join(f.root, outbox), "utf8"), before);
  for (const status of ["SYNCED", "SUPERSEDED", "unrecognized"]) assert.equal(recoveryAdvice({ id: "test-id", status }).automatic_action, false);
});

test("connection diagnostics report partial access honestly and never expose exception secrets", async t => {
  const f = fixture(t); f.save(".harness/local/atlassian.json", { site: "https://example.atlassian.net" });
  const { dashboardOverview, overviewLines } = require("../../tools/harness-cli/dashboard-status");
  const base = { root: f.root, env: { TELEGRAM_BOT_TOKEN: "private", TELEGRAM_CHAT_ID: "1" }, runGit: () => ({ status: 0, stdout: "" }), options: { "check-connections": true }, fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true }) }), checkAtlassian: async () => ({ jira: { status: "readable" }, confluence: { status: "permission-denied" }, site: "secret-site" }) };
  const partial = await dashboardOverview(base); assert.equal(partial.connections.atlassian.status, "partial-or-unavailable");
  assert.equal(partial.connections.telegram.status, "authenticated-bot-only"); assert.match(overviewLines(partial).join("\n"), /partial-or-unavailable/);
  assert.equal(JSON.stringify(partial).includes("secret-site"), false);
  const success = await dashboardOverview({ ...base, checkAtlassian: async () => ({ jira: { status: "readable" }, confluence: { status: "readable" } }) }); assert.equal(success.connections.atlassian.status, "readable");
  const failure = await dashboardOverview({ ...base, checkAtlassian: async () => { throw Error("private-token"); }, fetchImpl: async () => ({ ok: false, json: async () => ({ ok: false }) }) });
  assert.equal(failure.connections.atlassian.status, "unreachable-or-unauthorized"); assert.equal(failure.connections.telegram.status, "unauthorized-or-api-error"); assert.equal(JSON.stringify(failure).includes("private-token"), false);
  f.save(".harness/local/atlassian.json", "not-json"); assert.equal((await dashboardOverview(base)).connections.atlassian.status, "invalid-config");
});

test("Gemini thinking and Anthropic cached reads have distinct token accounting", () => {
  const { costMeter, estimateCost } = require("../../tools/harness-cli/observed-cost");
  const rate = { source: "https://ai.google.dev/pricing", as_of: "2026-10-03", input_per_million: 1, output_per_million: 2, cached_input_per_million: 0.1 };
  const gemini = costMeter("gemini", { usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10, thoughtsTokenCount: 5, cachedContentTokenCount: 20, totalTokenCount: 115 } });
  assert.equal(gemini.complete, true); assert.equal(gemini.output_tokens, 15);
  const estimate = (provider, meter) => estimateCost(provider, { models: { mock: 1 }, cost_meters: { mock: meter } }, { month: "2026-10", models: { [provider]: { mock: rate } } }, "2026-10", now());
  assert.equal(estimate("gemini", gemini).usd, 0.000112);
  const anthropic = costMeter("anthropic", { usage: { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 20 } });
  assert.equal(estimate("anthropic", anthropic).usd, 0.000122);
  assert.equal(costMeter("openai", { usage: { prompt_tokens: 1, completion_tokens: 1, prompt_tokens_details: { cache_write_tokens: 1 } } }).complete, false);
  assert.equal(costMeter("openai", { usage: { prompt_tokens: "1", completion_tokens: 1 } }).complete, false);
  assert.equal(costMeter("gemini", { usageMetadata: { promptTokenCount: 1, candidatesTokenCount: Number.MAX_SAFE_INTEGER, thoughtsTokenCount: 1 } }).complete, false);
});

test("pricing rejects invalid month/source/date/schema and token aggregation overflow is unknown", t => {
  const f = fixture(t); const { loadPricing } = require("../../tools/harness-cli/observed-cost");
  for (const entry of [{ source: "http://openai.com/pricing" }, { source: "https://evil.test/pricing" }, { source: "https://openai.com/pricing?token=secret" }, { as_of: "2026-02-30" }]) { pricing(f, entry); assert.throws(() => loadPricing(f.root), /pricing/); }
  for (const data of ["bad-json", { schema_version: "1.0", month: "2026-99", models: {} }, { schema_version: "1.0", month: "2026-10", models: { unsupported: {} } }, { schema_version: "1.0", month: "2026-10", models: [] }]) { f.save(".harness/local/pricing.json", data); assert.throws(() => loadPricing(f.root), /pricing/); }
  pricing(f); const service = createProviderUsageService({ root: f.root, now });
  service.record("openai", "mock", { usage: { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 0 } });
  service.record("openai", "mock", { usage: { prompt_tokens: 1, completion_tokens: 0 } });
  assert.equal(service.status({ cost: true }).providers[0].estimated_cost.status, "unknown");
});

test("aggregate USD overflow never reports an infinite estimate", () => {
  const { estimateCost } = require("../../tools/harness-cli/observed-cost");
  const meter = { input_tokens: 1, output_tokens: 0, cached_tokens: 0, complete: true }, rate = { input_per_million: Number.MAX_VALUE, output_per_million: 0, cached_input_per_million: 0, as_of: "2026-10-03", source: "https://openai.com/pricing" };
  // Individual arithmetic can overflow before division; keep unrepresentable prices unknown.
  meter.input_tokens = 2;
  const result = estimateCost("openai", { models: { mock: 2 }, cost_meters: { mock: meter } }, { month: "2026-10", models: { openai: { mock: rate } } }, "2026-10", now());
  assert.equal(result.status, "unknown"); assert.equal(result.usd, null); assert.equal(Number.isFinite(result.known_subtotal_usd), true);
});

test("review ticket resumes through CLI without fabricating completion and cannot be duplicated", { skip: Boolean(process.env.NODE_V8_COVERAGE) }, t => {
  const f = fixture(t), { spawnSync } = require("node:child_process");
  fs.cpSync(path.resolve(__dirname, "../../tools/harness-cli"), path.join(f.root, "tools/harness-cli"), { recursive: true });
  const git = spawnSync("git", ["init", "-b", "codex/review-test"], { cwd: f.root, encoding: "utf8" }); assert.equal(git.status, 0, git.stderr);
  f.save(".harness/tasks/review/old.md", "# TICKET: old\n## Operational Review\n- [ ] user acceptance\n");
  const env = { ...process.env, HARNESS_OFFLINE: "true" }; delete env.NODE_V8_COVERAGE;
  const run = args => spawnSync(process.execPath, [path.join(f.root, "tools/harness-cli/index.js"), ...args], { cwd: f.root, encoding: "utf8", env });
  const duplicate = run(["create-ticket", "old", "feat", "--goal", "duplicate"]); assert.notEqual(duplicate.status, 0); assert.match(duplicate.stderr + duplicate.stdout, /Review ticket already exists/);
  const resumed = run(["start-ticket", "old", "--from-review"]); assert.equal(resumed.status, 0, resumed.stderr + resumed.stdout);
  assert.equal(fs.existsSync(path.join(f.root, ".harness/tasks/review/old.md")), false);
  assert.match(fs.readFileSync(path.join(f.root, ".harness/tasks/active/old.md"), "utf8"), /user acceptance/);
  assert.equal(fs.existsSync(path.join(f.root, ".harness/tasks/archive/old.md")), false);
});
