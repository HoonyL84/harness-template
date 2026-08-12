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

test("CI detects and tests every supported product profile", () => {
  const workflow = read(".github/workflows/ci.yml");
  for (const output of [
    "has_gradle", "has_maven", "has_node", "has_python",
    "has_go", "has_rust", "has_dotnet"
  ]) {
    assert.ok(workflow.includes(`${output}: \${{ steps.detect.outputs.${output} }}`));
  }
  for (const job of ["gradle-ci", "maven-ci", "node-ci", "python-ci", "go-ci", "rust-ci", "dotnet-ci"]) {
    assert.match(workflow, new RegExp(`^  ${job}:`, "m"));
  }
});

test("Node CI enforces the configured coverage threshold", () => {
  const workflow = read(".github/workflows/ci.yml");
  assert.match(workflow, /p\.scripts\?\.coverage/);
  assert.match(workflow, /npm run coverage/);
  assert.match(workflow, /npm run test --if-present/);
});
