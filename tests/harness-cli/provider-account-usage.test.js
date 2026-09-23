"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createAccountUsage, normalizeRows } = require("../../tools/harness-cli/provider-account-usage");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "account-usage-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, now: () => Date.parse("2026-09-18T02:00:00Z") };
}
const response = (results, extra = {}) => new globalThis.Response(JSON.stringify({ data: [{ results }], has_more: false, ...extra }));

test("account reports distinguish missing reporting keys and offline state from zero balance", async t => {
  const f = fixture(t);
  let calls = 0;
  const env = { OPENAI_API_KEY: "normal-key" };
  const read = createAccountUsage({ ...f, env, fetchImpl: async () => { calls++; } });
  const report = await read();
  assert.equal(report.providers[0].status, "missing-admin-credential");
  assert.equal(report.providers[2].status, "missing-monitoring-credential");
  assert.ok(report.providers.every(p => p.actual_remaining.value === null));
  env.OPENAI_ADMIN_KEY = "private-admin"; env.HARNESS_OFFLINE = "true";
  assert.equal((await read()).providers[0].status, "offline"); assert.equal(calls, 0);
  await assert.rejects(read({ from: "2026-02-30" }), /Invalid/);
  await assert.rejects(read({ from: "not-date" }), /YYYY/);
  await assert.rejects(read({ from: "2026-09-20" }), /range/);
  await assert.rejects(read({ provider: "unknown" }), /Unknown/);
});
test("OpenAI pagination and credential-bound cache do not double-count cached input tokens", async t => {
  const f = fixture(t), env = { OPENAI_ADMIN_KEY: "admin-one" };
  let calls = 0;
  const read = createAccountUsage({ ...f, env, fetchImpl: async (url, init) => {
    calls++; assert.equal(init.redirect, "error"); assert.equal(init.headers.Authorization, `Bearer ${env.OPENAI_ADMIN_KEY}`);
    if (url.includes("costs")) return response([{ amount: { value: 1.25, currency: "usd" } }]);
    if (url.includes("page=")) return response([{ input_tokens: 3, output_tokens: 2 }]);
    return response([{ input_tokens: 10, input_cached_tokens: 5, output_tokens: 2 }], { has_more: true, next_page: "page2" });
  } });
  const options = { provider: "openai", from: "2026-09-10", to: "2026-09-17" };
  const item = (await read(options)).providers[0];
  assert.equal(item.usage.total_tokens, 17); assert.equal(item.cost.totals.USD, 1.25); assert.equal(calls, 3);
  assert.equal((await read(options)).providers[0].usage.cached, true); assert.equal(calls, 3);
  env.OPENAI_ADMIN_KEY = "admin-two"; await read(options); assert.equal(calls, 6);
  await read({ ...options, refresh: true }); assert.equal(calls, 9);
  const stored = fs.readFileSync(path.join(f.root, ".harness/local/provider-account-usage.json"), "utf8");
  assert.doesNotMatch(stored, /admin-one|admin-two/);
});
test("Anthropic cents convert to dollars and partial denial preserves usage without a fake cost", async t => {
  const f = fixture(t);
  const rows = [{ uncached_input_tokens: 10, cache_read_input_tokens: 5, output_tokens: 4,
    cache_creation: { ephemeral_1h_input_tokens: 2, ephemeral_5m_input_tokens: 3 } }];
  assert.equal(normalizeRows("anthropic", "usage", rows).total_tokens, 24);
  assert.equal(normalizeRows("anthropic", "cost", [{ amount: "123.45", currency: "USD" }]).totals.USD, 1.2345);
  assert.throws(() => normalizeRows("openai", "usage", [{}]), /Invalid/);
  assert.throws(() => normalizeRows("anthropic", "cost", [{ amount: "1", currency: "JPY" }]), /Unsupported/);
  const read = createAccountUsage({ ...f, env: { ANTHROPIC_ADMIN_KEY: "private" }, fetchImpl: async (url, init) => {
    assert.equal(init.headers["anthropic-version"], "2023-06-01");
    return url.includes("cost_report") ? new globalThis.Response("denied", { status: 403 }) : response(rows);
  } });
  const report = (await read({ provider: "anthropic" })).providers[0];
  assert.equal(report.status, "partial-or-unavailable"); assert.equal(report.usage.total_tokens, 24);
  assert.equal(report.cost.status, "permission-denied"); assert.equal(report.cost.value, null);
});
test("malformed and repeating cursor responses fail closed rather than returning partial totals", async t => {
  const f = fixture(t); let calls = 0;
  const read = createAccountUsage({ ...f, env: { OPENAI_ADMIN_KEY: "private" }, fetchImpl: async () => {
    calls++; return response([], { has_more: true, next_page: "repeated" });
  } });
  const item = (await read({ provider: "openai" })).providers[0];
  assert.equal(calls, 4); assert.equal(item.usage.status, "unavailable"); assert.equal(item.cost.value, null);
});
