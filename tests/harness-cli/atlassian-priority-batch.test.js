"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { createPriorityBatchCommand } = require("../../tools/harness-cli/atlassian-priority-batch");
const { writeJsonAtomic } = require("../../tools/harness-cli/control-plane-state");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "priority-batch-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const configFile = path.join(root, ".harness/local/atlassian.json");
  const config = { transport: "mcp", site: "https://personal.atlassian.net", cloud_id: "12345678-1234-1234-1234-123456789abc", jira_projects: { demo: "DEMO" } };
  writeJsonAtomic(configFile, config);
  const issues = new Map(Array.from({ length: 4 }, (_, i) => [`DEMO-${i + 1}`, { id: String(i + 1), key: `DEMO-${i + 1}`, fields: {
    project: { key: "DEMO" }, priority: { id: "3", name: "Medium" }, status: { id: "10" }, updated: "initial" } }]));
  let clock = 1000, onWrite, onRead;
  const calls = [];
  const send = async (c, service, endpoint, payload) => {
    calls.push({ endpoint, payload });
    if (payload) {
      const issue = issues.get(endpoint.split("/").at(-1));
      if (onWrite) await onWrite(issue, payload);
      issue.fields.priority = { id: "2", name: payload.fields.priority.name }; issue.fields.updated = "changed";
      return { id: issue.id, key: issue.key };
    }
    const keys = [...new URL(endpoint, c.site).searchParams.get("jql").matchAll(/"(DEMO-[0-9]+)"/g)].map(m => m[1]);
    let result = { issues: keys.map(key => globalThis.structuredClone(issues.get(key))), isLast: true };
    if (onRead) result = await onRead(result);
    return result;
  };
  const command = createPriorityBatchCommand({ root, send, now: () => clock });
  const file = path.join(root, "changes.json");
  const prepare = async (changes = [...issues.keys()].map(key => ({ key, priority: "High" }))) => {
    writeJsonAtomic(file, { changes }); return command("priority-plan", null, { project: "demo", file });
  };
  const batchFile = id => path.join(root, ".harness/local/atlassian/priority-batches", id + ".json");
  return { root, issues, calls, command, prepare, batchFile, configFile, config, file,
    tick: value => { clock += value; }, setWrite: fn => { onWrite = fn; }, setRead: fn => { onRead = fn; } };
}

test("priority apply uses two batch reads and four writes, then rejects replay", async t => {
  const f = fixture(t), preview = await f.prepare();
  assert.equal(f.calls.length, 1);
  const result = await f.command("priority-apply", preview.id, { approve: preview.approval_digest });
  assert.equal(result.status, "VERIFIED"); assert.equal(result.changes.length, 4);
  assert.equal(f.calls.filter(c => !c.payload).length, 3); // one preview plus two apply reads
  assert.equal(f.calls.filter(c => c.payload).length, 4);
  const count = f.calls.length;
  await assert.rejects(f.command("priority-apply", preview.id, { approve: preview.id }), /unused/);
  assert.equal(f.calls.length, count);
});

test("no-op priorities skip writes but still verify current state", async t => {
  const f = fixture(t), preview = await f.prepare([{ key: "DEMO-1", priority: "Medium" }]);
  const result = await f.command("priority-apply", preview.id, { approve: preview.id });
  assert.equal(result.status, "VERIFIED"); assert.equal(f.calls.filter(c => c.payload).length, 0);
});

test("wrong, stale, expired and changed-connection approvals fail before writes", async t => {
  const f = fixture(t), preview = await f.prepare();
  await assert.rejects(f.command("priority-apply", preview.id, { approve: "bad" }), /approval/);
  f.issues.get("DEMO-1").fields.updated = "stale";
  await assert.rejects(f.command("priority-apply", preview.id, { approve: preview.id }), /changed after preview/);
  f.issues.get("DEMO-1").fields.updated = "initial";
  writeJsonAtomic(f.configFile, { ...f.config, mcp: { bindings: {} } });
  await assert.rejects(f.command("priority-apply", preview.id, { approve: preview.id }), /connection changed/);
  writeJsonAtomic(f.configFile, f.config); f.tick(600001);
  await assert.rejects(f.command("priority-apply", preview.id, { approve: preview.id }), /expired/);
  assert.equal(f.calls.filter(c => c.payload).length, 0);
});

test("uncertain writes stop the batch and reconciliation never resends", async t => {
  const f = fixture(t), preview = await f.prepare();
  f.setWrite(async (issue, payload) => {
    issue.fields.priority = { id: "2", name: payload.fields.priority.name };
    throw new Error("private provider detail");
  });
  await assert.rejects(f.command("priority-apply", preview.id, { approve: preview.id }), /incomplete/);
  assert.equal(f.calls.filter(c => c.payload).length, 1);
  let record = await f.command("priority-show", preview.id, {});
  assert.equal(record.status, "NEEDS_RECONCILIATION"); assert.equal(record.changes[0].state, "UNKNOWN");
  assert.equal(record.changes[1].state, "NOT_ATTEMPTED");
  await assert.rejects(f.command("priority-apply", preview.id, { approve: preview.id }), /unused/);
  record = await f.command("priority-reconcile", preview.id, {});
  assert.equal(record.status, "PARTIAL"); assert.equal(record.changes[0].state, "OBSERVED_DESIRED");
  assert.equal(f.calls.filter(c => c.payload).length, 1);
  assert.doesNotMatch(fs.readFileSync(f.batchFile(preview.id), "utf8"), /private provider/);
});

test("verification read failure preserves attempts and read-only recovery", async t => {
  const f = fixture(t), preview = await f.prepare([{ key: "DEMO-1", priority: "High" }]);
  let reads = 0;
  f.setRead(result => { if (++reads === 2) throw new Error("read unavailable"); return result; });
  await assert.rejects(f.command("priority-apply", preview.id, { approve: preview.id }), /incomplete/);
  f.setRead(undefined);
  const result = await f.command("priority-reconcile", preview.id, {});
  assert.equal(result.status, "OBSERVED_DESIRED"); assert.equal(f.calls.filter(c => c.payload).length, 1);
});

test("invalid input, cross-project/missing search evidence and tampered plans are rejected", async t => {
  const f = fixture(t);
  for (const changes of [[], [{ key: "OTHER-1", priority: "High" }], [{ key: "DEMO-1", priority: "Urgent" }],
    [{ key: "DEMO-1", priority: "High", fields: {} }], [{ key: "DEMO-1", priority: "High" }, { key: "DEMO-1", priority: "Low" }]]) {
    await assert.rejects(f.prepare(changes), /explicit|unique/);
  }
  f.setRead(() => ({ issues: [], isLast: true }));
  await assert.rejects(f.prepare(), /missing/);
  f.setRead(result => ({ ...result, issues: [{ ...result.issues[0], fields: { ...result.issues[0].fields, project: { key: "OTHER" } } }] }));
  await assert.rejects(f.prepare(), /mismatch/);
  f.setRead(undefined);
  const preview = await f.prepare();
  const file = f.batchFile(preview.id), value = JSON.parse(fs.readFileSync(file));
  value.plan.changes[0].priority = "Low"; writeJsonAtomic(file, value);
  await assert.rejects(f.command("priority-apply", preview.id, { approve: preview.id }), /content/);
  await assert.rejects(f.command("priority-show", "../bad", {}), /batch id/);
  assert.equal(f.calls.filter(c => c.payload).length, 0);
});

test("concurrent application consumes a batch once and mid-flight connection change stops writes", async t => {
  const f = fixture(t), preview = await f.prepare();
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  f.setWrite(async () => { entered(); await gate; });
  const first = f.command("priority-apply", preview.id, { approve: preview.id });
  await started;
  await assert.rejects(f.command("priority-apply", preview.id, { approve: preview.id }), /locked/);
  writeJsonAtomic(f.configFile, { ...f.config, cloud_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }); release();
  await assert.rejects(first, /incomplete/);
  assert.equal(f.calls.filter(c => c.payload).length, 1);
});

test("paged searches detect loops and reject REST and pre-apply reconciliation", async t => {
  const f = fixture(t);
  f.setRead(() => ({ issues: [], nextPageToken: "repeat" }));
  await assert.rejects(f.prepare(), /pagination/);
  f.setRead(undefined); const preview = await f.prepare();
  await assert.rejects(f.command("priority-reconcile", preview.id, {}), /attempted/);
  writeJsonAtomic(f.configFile, { ...f.config, transport: "rest" });
  await assert.rejects(f.prepare(), /MCP/);
});
