"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { repositoryContentFingerprint } = require("../../tools/harness-cli/content-fingerprint");

test("repository fingerprint changes with tracked content and ignores excluded paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-fingerprint-"));
  fs.writeFileSync(path.join(root, "tracked.txt"), "one");
  const runGit = (args) => ({ status: 0, stdout: args[0] === "status" ? "" : "tracked.txt\0", stderr: "" });
  const before = repositoryContentFingerprint(root, runGit);
  fs.writeFileSync(path.join(root, "tracked.txt"), "two");
  const after = repositoryContentFingerprint(root, runGit);
  assert.notEqual(before, after);
});

test("repository fingerprint fails closed when Git inventory is unavailable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-fingerprint-fail-"));
  assert.equal(repositoryContentFingerprint(root, () => ({ status: 1, stdout: "", stderr: "failed" })), null);
  assert.equal(repositoryContentFingerprint(root, () => ({ status: 0, stdout: "../escape.txt\0", stderr: "" })), null);
});
