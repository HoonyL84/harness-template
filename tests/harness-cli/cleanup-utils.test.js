"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createCleanupManifest,
  findGeneratedPaths,
  isCleanupManifestValid
} = require("../../tools/harness-cli/cleanup-utils");

test("cleanup only selects paths created after verification starts", () => {
  assert.deepEqual(
    findGeneratedPaths(["draft.js"], ["draft.js", "coverage.tmp"]),
    ["coverage.tmp"]
  );
});

test("cleanup manifest integrity detects tampering", () => {
  const manifest = createCleanupManifest("demo", "2026-06-13T00:00:00Z", [
    { path: "coverage.tmp", sha256: "abc" }
  ]);
  assert.equal(isCleanupManifestValid(manifest), true);
  manifest.files[0].path = "src/user-draft.js";
  assert.equal(isCleanupManifestValid(manifest), false);
});
