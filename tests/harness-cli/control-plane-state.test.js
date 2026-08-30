"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  acquireFileLock,
  readJson,
  releaseFileLock,
  updateJsonLocked,
  writeJsonAtomic
} = require("../../tools/harness-cli/control-plane-state");

test("control-plane state serializes writers and preserves the latest value", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-state-lock-"));
  const filePath = path.join(root, "state.json");
  writeJsonAtomic(filePath, { count: 0 });
  const lock = acquireFileLock(filePath);
  assert.throws(() => updateJsonLocked(filePath, {}, (value) => ({ count: value.count + 1 })), /locked by another writer/);
  releaseFileLock(lock);
  updateJsonLocked(filePath, {}, (value) => ({ count: value.count + 1 }));
  assert.deepEqual(readJson(filePath), { count: 1 });
  assert.equal(fs.existsSync(`${filePath}.lock`), false);
});

test("expired state locks are reclaimed without temp-file residue", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-state-stale-"));
  const filePath = path.join(root, "state.json");
  fs.writeFileSync(`${filePath}.lock`, JSON.stringify({ token: "stale", expires_at: "2020-01-01T00:00:00.000Z" }));
  updateJsonLocked(filePath, { values: [] }, (value) => ({ values: [...value.values, "safe"] }), { now: () => Date.parse("2026-01-01T00:00:00.000Z") });
  assert.deepEqual(readJson(filePath), { values: ["safe"] });
  assert.deepEqual(fs.readdirSync(root).filter((name) => name.includes(".tmp-") || name.includes(".stale-")), []);
});

test("state locks are released when an updater fails", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-state-error-"));
  const filePath = path.join(root, "state.json");
  assert.throws(() => updateJsonLocked(filePath, {}, () => { throw new Error("boom"); }), /boom/);
  assert.equal(fs.existsSync(`${filePath}.lock`), false);
});

test("a newly created incomplete lock fails closed instead of being reclaimed", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-state-incomplete-"));
  const filePath = path.join(root, "state.json");
  fs.writeFileSync(`${filePath}.lock`, "");
  assert.throws(() => updateJsonLocked(filePath, {}, () => ({})), /locked by another writer/);
});
