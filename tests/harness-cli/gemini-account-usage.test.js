"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAccountUsage } = require("../../tools/harness-cli/provider-account-usage");
const period = { provider: "gemini", from: "2026-09-10", to: "2026-09-17" };
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gemini-usage-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, now: () => Date.parse("2026-09-18T02:00:00Z"), env: { GOOGLE_CLOUD_PROJECT: "personal-project", GOOGLE_CLOUD_ACCESS_TOKEN: "oauth-secret" } };
}
function series(start = "2026-09-11T00:00:00Z", count = "7") {
  return { metric: { type: "serviceruntime.googleapis.com/api/request_count", labels: { response_code: "200" } },
    resource: { type: "consumed_api", labels: { service: "generativelanguage.googleapis.com", project_id: "personal-project" } },
    metricKind: "DELTA", valueType: "INT64", points: [{ interval: { startTime: start, endTime: new Date(Date.parse(start) + 60000).toISOString() }, value: { int64Value: count } }] };
}
const response = body => new globalThis.Response(JSON.stringify(body));

test("Gemini counts scoped DELTA requests, paginates, caches per credential, and never implies token balance", async t => {
  const f = fixture(t); let calls = 0;
  const read = createAccountUsage({ ...f, fetchImpl: async (url, init) => {
    calls++; assert.equal(init.headers.Authorization, `Bearer ${f.env.GOOGLE_CLOUD_ACCESS_TOKEN}`);
    assert.equal(init.method, "GET"); assert.equal(init.redirect, "error"); assert.doesNotMatch(url, /oauth-secret/);
    const u = new URL(url); assert.match(u.searchParams.get("filter"), /generativelanguage.googleapis.com/);
    assert.equal(u.searchParams.get("view"), "FULL");
    assert.equal(u.searchParams.get("aggregation.perSeriesAligner"), "ALIGN_SUM");
    assert.equal(u.searchParams.get("aggregation.alignmentPeriod"), "86400s");
    return u.searchParams.has("pageToken") ? response({ timeSeries: [series("2026-09-12T00:00:00Z", "2")] })
      : response({ timeSeries: [series()], nextPageToken: "next" });
  } });
  const item = (await read(period)).providers[0];
  assert.equal(item.usage.requests, 9); assert.equal(item.usage.unit, "requests"); assert.equal(item.actual_remaining.value, null);
  assert.equal(item.cost.value, null); assert.equal(item.status, "partial"); assert.equal(calls, 2);
  assert.equal((await read(period)).providers[0].usage.cached, true); assert.equal(calls, 2);
  await read({ ...period, refresh: true }); assert.equal(calls, 4);
  f.env.GOOGLE_CLOUD_ACCESS_TOKEN = "new-secret"; await read(period); assert.equal(calls, 6);
  assert.doesNotMatch(fs.readFileSync(path.join(f.root, ".harness/local/gemini-account-usage.json"), "utf8"), /oauth-secret|new-secret/);
});

test("Gemini separates missing permissions, expired OAuth, no data, true zero and malformed responses", async t => {
  const f = fixture(t); let body = {}, calls = 0;
  const read = createAccountUsage({ ...f, fetchImpl: async () => { calls++; return body instanceof globalThis.Response ? body : response(body); } });
  const get = async () => (await read({ ...period, refresh: true })).providers[0];
  assert.equal((await get()).usage.status, "no-data"); assert.equal((await get()).usage.requests, null);
  body = { timeSeries: [series(undefined, "0")] }; assert.equal((await get()).usage.requests, 0);
  body = new globalThis.Response("oauth-secret", { status: 401 }); assert.equal((await get()).usage.status, "permission-denied");
  for (const invalid of [{ timeSeries: "invalid" }, { executionErrors: [{}] }, { timeSeries: [series("2026-09-09T23:59:00Z")] },
    { timeSeries: [series(), series()] }, { timeSeries: [{ ...series(), metricKind: "GAUGE" }] }, { timeSeries: [series(undefined, "9007199254740992")] }]) {
    body = invalid; assert.equal((await get()).usage.status, "unavailable");
  }
  body = { timeSeries: [], nextPageToken: "loop" }; assert.equal((await get()).usage.status, "unavailable");
  f.env.HARNESS_OFFLINE = "true"; const previous = calls; assert.equal((await get()).status, "offline"); assert.equal(calls, previous);
  delete f.env.HARNESS_OFFLINE; f.env.GOOGLE_CLOUD_PROJECT = "../invalid"; assert.equal((await get()).status, "invalid-project");
  delete f.env.GOOGLE_CLOUD_ACCESS_TOKEN; assert.equal((await get()).status, "missing-monitoring-credential");
});
