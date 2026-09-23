"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { writeJsonAtomic, readJson } = require("../../tools/harness-cli/control-plane-state");
const { appendHistory, collectHistory, filterHistory, refreshHistory, withHistory, createHistoryCommand } = require("../../tools/harness-cli/work-history");
const { buildProjectContextBundle } = require("../../tools/harness-cli/project-context");

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "history-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const local = path.join(root, ".harness", "local");
  const save = (file, value) => writeJsonAtomic(path.join(local, file), value);
  const event = { project_id: "demo", ticket_id: "feature", request_id: "demo-work", timestamp: "2026-09-18T00:00:00Z",
    kind: "TICKET", status: "REVIEW_READY", priority: "P1", title: "결제 개선", technologies: ["node"], fingerprint: "verified" };
  return { root, local, save, event };
}
const parseArgs = args => {
  const positional = [], options = {};
  for (let i = 0; i < args.length; i++) args[i].startsWith("--") ? options[args[i].slice(2)] = args[++i] : positional.push(args[i]);
  return { positional, options };
};

test("history keeps immutable snapshots, filters Korean/date/status and deduplicates refresh", t => {
  const f = setup(t);
  appendHistory(f.root, f.event); appendHistory(f.root, f.event);
  appendHistory(f.root, { ...f.event, project_id: "other", title: "광고" });
  assert.equal(collectHistory(f.root).length, 2);
  assert.equal(filterHistory(collectHistory(f.root), { project: "demo", query: "결제", technology: "NODE", priority: "P1", from: "2026-09-17", to: "2026-09-19" }).length, 1);
  assert.equal(filterHistory(collectHistory(f.root), { status: "BLOCKED" }).length, 0);
  assert.throws(() => filterHistory([], { from: "wrong" }), /Invalid/);
  assert.throws(() => filterHistory([], { from: "2026-09-19", to: "2026-09-17" }), /exceed/);
  refreshHistory(f.root); refreshHistory(f.root);
  assert.equal(collectHistory(f.root).length, 2);
});

test("managed history intent precedes effects; failure cannot be recorded as success", async t => {
  const f = setup(t), ledger = path.join(f.local, "history", "ledger.json");
  await withHistory(f.root, "runner", () => {
    assert.equal(Object.values(readJson(ledger)).length, 3);
    assert.equal(Object.values(readJson(ledger).operations)[0].status, "STARTED");
  })(["run", "demo-work"]);
  await assert.rejects(withHistory(f.root, "runner", () => { throw new Error("secret error"); })(["run", "demo-work"]), /secret error/);
  const state = readJson(ledger);
  assert.deepEqual(Object.values(state.operations).map(o => o.status), ["SUCCEEDED", "FAILED"]);
  assert.equal(JSON.stringify(state).includes("secret error"), false);
  fs.writeFileSync(ledger, "broken");
  let called = false;
  await assert.rejects(withHistory(f.root, "runner", () => { called = true; })([]), /invalid JSON/);
  assert.equal(called, false);
});

test("legacy tickets have unknown verification and project history is bounded and isolated", t => {
  const f = setup(t);
  const dir = path.join(f.root, ".harness", "tasks", "archive");
  fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "old-task.md"), "## Goal\n- A legacy task");
  assert.equal(collectHistory(f.root)[0].verification, "unknown");
  appendHistory(f.root, f.event);
  appendHistory(f.root, { ...f.event, project_id: "other", title: "PRIVATE_OTHER_PROJECT" });
  const bundle = buildProjectContextBundle({ id: "demo", path: f.root }, { historyRoot: f.root, maxBytes: 2048 });
  assert.match(bundle.content, /결제 개선/); assert.doesNotMatch(bundle.content, /PRIVATE_OTHER_PROJECT/);
  assert.equal(bundle.bytes, Buffer.byteLength(bundle.content)); assert.ok(bundle.bytes <= 2048);
});

test("review uses current source not stale saved snapshots and rejects changed worktrees", t => {
  const f = setup(t);
  f.save("projects.json", { projects: { demo: { path: f.root, stacks: ["node"] } } });
  f.save("requests/demo-work.json", { request_id: "demo-work", status: "APPROVED", generated_at: f.event.timestamp,
    tickets: [{ ticket_id: "feature", project_id: "demo", goal: "Work" }] });
  f.save("executions/demo-work.json", { request_id: "demo-work", updated_at: f.event.timestamp,
    tickets: [{ ticket_id: "feature", project_id: "demo", status: "REVIEW_READY", worktree: f.root,
      verification: { content_fingerprint: "verified" }, runner: { history: [{ status: "FAILED", attempt: 1 }] },
      release_history: [{ operation: "commit", commit: "abc", recorded_at: f.event.timestamp }] }] });
  appendHistory(f.root, { ...f.event, status: "BLOCKED" }); refreshHistory(f.root);
  let fingerprint = "changed";
  const command = createHistoryCommand({ root: f.root, parseArgs, log: () => {}, reviewFingerprint: () => fingerprint });
  const args = ["review", "--project", "demo", "--request", "demo-work", "--ticket", "feature", "--fingerprint", "verified", "--result", "accepted", "--reason", "Reviewed tests"];
  assert.throws(() => command(args), /content changed/);
  fingerprint = "verified";
  assert.equal(command(args).kind, "USER_REVIEW");
  assert.ok(command(["search", "--kind", "RELEASE"]).length === 1);
  command(["refresh"]); command(["status"]);
  assert.throws(() => command(["other"]), /Usage/);
});
