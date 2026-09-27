"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { writeJsonAtomic } = require("../../tools/harness-cli/control-plane-state");
const { createAtlassianCommand } = require("../../tools/harness-cli/atlassian-command");
const { requirePublishedDraftImported } = require("../../tools/harness-cli/jira-input");
const { createRequestPlan } = require("../../tools/harness-cli/request-plan");
const parseArgs = args => {
  const positional = [], options = {};
  for (let i = 0; i < args.length; i++) args[i].startsWith("--") ? options[args[i].slice(2)] = args[++i] : positional.push(args[i]);
  return { positional, options };
};
function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "atlassian-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const local = path.join(root, ".harness", "local");
  const config = { transport: "rest", site: "https://personal.atlassian.net", jira_projects: { demo: "DEMO" }, jira_issue_types: { demo: "10001" },
    confluence_projects: { demo: { space_id: "12", parent_id: "34" } } };
  const saveConfig = () => writeJsonAtomic(path.join(local, "atlassian.json"), config);
  saveConfig();
  const summaryFile = path.join(root, "summary.json");
  writeJsonAtomic(summaryFile, { title: "Result", summary: "Reviewed <script> & result", request_id: "work", ticket_id: "feature" });
  writeJsonAtomic(path.join(local, "requests", "work.json"), { status: "DRAFT", tickets: [{ project_id: "demo", ticket_id: "feature", goal: "Test feature", test_plan: {} }] });
  const calls = [], env = { ATLASSIAN_EMAIL: "demo@test.org", ATLASSIAN_API_TOKEN: "private-key" };
  let fetch = async () => ({ id: "123", key: "DEMO-1" });
  const command = createAtlassianCommand({ root, parseArgs, log: () => {}, env, fetchImpl: async (url, init) => {
    calls.push({ url, init }); const result = await fetch(url, init);
    return result instanceof globalThis.Response ? result : new globalThis.Response(JSON.stringify(result));
  } });
  return { root, local, summaryFile, calls, command, config, saveConfig, env, setFetch: fn => { fetch = fn; } };
}
test("Atlassian requires exact preview approval, creates only sanitized explicit payload, suppresses repeats", async t => {
  const f = setup(t);
  const args = ["queue-result", "--project", "demo", "--file", f.summaryFile];
  const entry = await f.command(args); await f.command(args);
  assert.equal((await f.command(["status"])).entries.length, 1);
  assert.match(entry.payload.body.value, /&lt;script&gt; &amp;/);
  await assert.rejects(f.command(["sync", "--approve", "bad"]), /approval_digest/); assert.equal(f.calls.length, 0);
  const { approval_digest } = await f.command(["preview"]);
  await f.command(["sync", "--approve", approval_digest]);
  assert.equal(f.calls[0].url, "https://personal.atlassian.net/wiki/api/v2/pages");
  assert.equal(f.calls[0].init.redirect, "error");
  assert.equal((await f.command(["status"])).entries[0].status, "SYNCED");
  await assert.rejects(f.command(["sync", "--approve", approval_digest]), /approval_digest/);
  assert.equal(f.calls.length, 1);
});
test("lost POST response is not retried and matching remote record can be reconciled", async t => {
  const f = setup(t);
  const entry = await f.command(["queue-ticket", "work", "--ticket", "feature"]);
  assert.throws(() => requirePublishedDraftImported(f.root, { request_id: "work", tickets: [{ ticket_id: "feature" }] }), /import/);
  requirePublishedDraftImported(f.root, { request_id: "different", tickets: [{ ticket_id: "feature" }] });
  const { approval_digest } = await f.command(["preview"]);
  f.setFetch(async () => { throw new Error("secret network message"); });
  await assert.rejects(f.command(["sync", "--approve", approval_digest]), /incomplete/);
  const state = await f.command(["status"]);
  assert.equal(state.entries[0].status, "NEEDS_RECONCILIATION");
  assert.doesNotMatch(JSON.stringify(state), /secret network/);
  await assert.rejects(f.command(["sync", "--approve", approval_digest]), /approval_digest/);
  f.setFetch(async () => ({ id: "123", fields: { project: { key: "OTHER" }, labels: [entry.marker] } }));
  await assert.rejects(f.command(["reconcile", entry.id, "--remote-id", "123"]), /does not match/);
  f.setFetch(async () => ({ id: "123", fields: { project: { key: "DEMO" }, labels: [entry.marker] } }));
  assert.equal((await f.command(["reconcile", entry.id, "--remote-id", "123"])).entries[0].status, "SYNCED");
});
test("link accepts Jira's default priority when publication did not request a mapped priority", async t => {
  const f = setup(t);
  const profile = { status: "APPROVED", content_fingerprint: "profile-fingerprint", verify_commands: ["npm test"] };
  const plan = createRequestPlan({ requestId: "work", goal: "Test feature", profiles: { demo: profile }, tickets: [{
    project_id: "demo", ticket_id: "feature", goal: "Test feature", priority: "P3",
    acceptance_criteria: ["Ticket is linked"], implementation_steps: ["Publish ticket"], test_plan: { manual: ["Inspect Jira"] }
  }] });
  writeJsonAtomic(path.join(f.local, "requests", "work.json"), plan);
  const entry = await f.command(["queue-ticket", "work", "--ticket", "feature"]);
  const preview = await f.command(["preview"]);
  f.setFetch(async (url, init) => {
    if (init.method === "POST") return { id: "123", key: "DEMO-1" };
    return { id: "123", key: "DEMO-1", fields: { project: { key: "DEMO" }, summary: entry.payload.fields.summary,
      description: entry.payload.fields.description, priority: { id: "3", name: "Medium" }, updated: "revision-a", labels: [entry.marker] } };
  });
  await f.command(["sync", "--approve", preview.approval_digest]);
  const linked = await f.command(["link", "work", "--ticket", "feature"]);
  assert.equal(linked.tickets[0].source.issue_key, "DEMO-1");
});
test("destination changes, offline mode and modified preview block all writes", async t => {
  const f = setup(t);
  await f.command(["queue-ticket", "work", "--ticket", "feature"]);
  const { approval_digest } = await f.command(["preview"]);
  f.config.site = "https://different.atlassian.net"; f.saveConfig();
  await assert.rejects(f.command(["sync", "--approve", approval_digest]), /destination changed/);
  f.config.site = "https://personal.atlassian.net"; f.saveConfig();
  f.env.HARNESS_OFFLINE = "1";
  await assert.rejects(f.command(["sync", "--approve", approval_digest]), /Online/);
  delete f.env.HARNESS_OFFLINE;
  await f.command(["queue-result", "--project", "demo", "--file", f.summaryFile]);
  await assert.rejects(f.command(["sync", "--approve", approval_digest]), /approval_digest/);
  assert.equal(f.calls.length, 0);
  writeJsonAtomic(path.join(f.local, "requests/work.json"), { status: "DRAFT", tickets: [{ project_id: "demo", ticket_id: "feature", goal: "Edited feature" }] });
  await assert.rejects(f.command(["queue-ticket", "work", "--ticket", "feature"]), /different content/);
});
test("concurrent sync cannot duplicate a batch, HTTP errors retain uncertain evidence", async t => {
  const f = setup(t);
  await f.command(["queue-result", "--project", "demo", "--file", f.summaryFile]);
  const { approval_digest } = await f.command(["preview"]);
  f.setFetch(async () => {
    await assert.rejects(f.command(["sync", "--approve", approval_digest]), /approval_digest/);
    return new globalThis.Response("failure", { status: 429 });
  });
  await assert.rejects(f.command(["sync", "--approve", approval_digest]), /incomplete/);
  assert.equal(f.calls.length, 1);
  assert.equal((await f.command(["status"])).entries[0].error, "HTTP 429");
  const entry = (await f.command(["status"])).entries[0];
  await f.command(["retry-rejected", entry.id, "--approve", entry.id]);
  const next = await f.command(["preview"]);
  assert.notEqual(next.approval_digest, approval_digest);
  await assert.rejects(f.command(["sync", "--approve", approval_digest]), /approval_digest/);
  f.setFetch(async () => ({ id: "123" }));
  await f.command(["sync", "--approve", next.approval_digest]);
  assert.equal(f.calls.length, 2);
});

test("Jira status transition requires available transition and rejects changed status after approval", async t => {
  const f = setup(t);
  const issue = { id: "123", fields: { project: { key: "DEMO" }, status: { id: "1" }, updated: "revision-a" } };
  let posts = 0;
  f.setFetch(async (url, init) => {
    if (init.method === "POST") { posts++; return new globalThis.Response(null, { status: 204 }); }
    if (url.endsWith("/transitions")) return { transitions: [{ id: "55", to: { id: "2" } }] };
    return issue;
  });
  await f.command(["queue-status", "--project", "demo", "--issue", "DEMO-1", "--status-id", "2"]);
  const preview = await f.command(["preview"]);
  assert.equal(preview.items[0].transition.from_status, "1");
  issue.fields.updated = "revision-b";
  await assert.rejects(f.command(["sync", "--approve", preview.approval_digest]), /incomplete/);
  assert.equal(posts, 0);
  await f.command(["queue-status", "--project", "demo", "--issue", "DEMO-1", "--status-id", "2"]);
  const updated = await f.command(["preview"]);
  await f.command(["sync", "--approve", updated.approval_digest]);
  assert.equal(posts, 1);
  issue.fields.status.id = "2";
  assert.equal((await f.command(["queue-status", "--project", "demo", "--issue", "DEMO-1", "--status-id", "2"])).status, "UNCHANGED");
});
