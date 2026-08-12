"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("dependency audit remains a blocking security gate", () => {
  const workflow = read(".github/workflows/security.yml");
  assert.match(workflow, /run:\s*npm audit --audit-level=high/);
  assert.doesNotMatch(workflow, /npm audit --audit-level=high\s*\|\|\s*true/);
});

test("cross-platform smoke tests isolate harness verification from product tests", () => {
  for (const script of ["scripts/smoke-test.sh", "scripts/smoke-test.ps1"]) {
    assert.match(read(script), /HARNESS_SMOKE_VERIFY_COMMAND/);
  }
});
