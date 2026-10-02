"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { assertReleaseGate } = require("../../tools/harness-cli/ci-release-gate");

function results() {
  const flags = { has_node: "true", has_gradle: "false", has_maven: "false", has_python: "false", has_go: "false", has_rust: "false", has_dotnet: "false" };
  const needs = { "detect-project": { result: "success", outputs: flags },
    "harness-governance": { result: "success" }, "harness-cross-platform": { result: "success" } };
  for (const profile of ["node", "gradle", "maven", "python", "go", "rust", "dotnet"]) {
    needs[`${profile}-ci`] = { result: flags[`has_${profile}`] === "true" ? "success" : "skipped" };
  }
  return needs;
}

test("release gate accepts only successful core and applicable profile jobs", () => {
  assert.equal(assertReleaseGate(results()), true);
  const all = results();
  for (const flag of Object.keys(all["detect-project"].outputs)) all["detect-project"].outputs[flag] = "true";
  for (const [name, job] of Object.entries(all)) if (name.endsWith("-ci")) job.result = "success";
  assert.equal(assertReleaseGate(all), true);
});

test("release gate refuses missing, failed, cancelled and skipped required checks", () => {
  for (const input of [null, [], "success"]) assert.throws(() => assertReleaseGate(input), /missing/);
  for (const job of ["detect-project", "harness-governance", "harness-cross-platform", "node-ci"]) {
    for (const status of [undefined, "failure", "cancelled", "skipped", "pending"]) {
      const needs = results(); needs[job].result = status;
      assert.throws(() => assertReleaseGate(needs), /Required CI job|must be success/);
    }
  }
  const missing = results(); delete missing["node-ci"];
  assert.throws(() => assertReleaseGate(missing), /missing/);
});

test("release gate distinguishes legitimate profile skips from invalid detection", () => {
  const needs = results(); delete needs["detect-project"].outputs.has_node;
  assert.throws(() => assertReleaseGate(needs), /detection output/);
  needs["detect-project"].outputs.has_node = true;
  assert.throws(() => assertReleaseGate(needs), /detection output/);
  const unexpected = results(); unexpected["python-ci"].result = "success";
  assert.throws(() => assertReleaseGate(unexpected), /must be skipped/);
});

test("workflow policy pins external actions and runner labels and cannot silently skip release gate", () => {
  const root = path.resolve(__dirname, "../..");
  for (const name of ["ci.yml", "security.yml"]) {
    const text = fs.readFileSync(path.join(root, ".github/workflows", name), "utf8");
    const refs = [...text.matchAll(/uses:\s*([^\s#]+)/g)].map(match => match[1]);
    assert.ok(refs.length > 0);
    refs.forEach(ref => assert.match(ref, /^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/));
    assert.doesNotMatch(text, /(?:ubuntu|macos|windows)-latest/);
    assert.match(text, /workflow_dispatch:/);
    assert.match(text, /schedule:/);
  }
  const ci = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  assert.match(ci, /name: Release Gate/);
  assert.match(ci, /if: \$\{\{ always\(\) \}\}/);
  assert.match(ci, /CI_NEEDS_JSON: \$\{\{ toJSON\(needs\) \}\}/);
  const envTemplate = fs.readFileSync(path.join(root, ".env.template"), "utf8");
  assert.match(envTemplate, /^CI_NEEDS_JSON=$/m);
  assert.match(ci, /node tools\/harness-cli\/ci-release-gate\.js/);
  assert.match(ci, /os: \[ubuntu-24\.04, macos-15, windows-2025\]/);
  const jobs = [...ci.split("jobs:")[1].matchAll(/^  ([\w-]+):$/gm)].map(match => match[1]).filter(name => name !== "release-gate");
  const gateNeeds = ci.match(/needs: \[([^\]]+)\]/)[1].split(",").map(name => name.trim());
  assert.deepEqual(gateNeeds.sort(), jobs.sort());
});

test("main protection requires current verified checks and PRs without an admin bypass", () => {
  const policy = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../.github/main-protection.json"), "utf8"));
  assert.equal(policy.required_status_checks.strict, true);
  assert.equal(policy.enforce_admins, true);
  assert.equal(policy.allow_force_pushes, false);
  assert.equal(policy.allow_deletions, false);
  assert.equal(policy.required_linear_history, true);
  assert.equal(policy.required_conversation_resolution, true);
  assert.equal(policy.required_pull_request_reviews.required_approving_review_count, 0);
  // GitHub rejects organization-only bypass allowances on personal repositories.
  assert.equal(Object.hasOwn(policy.required_pull_request_reviews, "bypass_pull_request_allowances"), false);
  // Use app-bound checks alone; legacy contexts and checks conflict in the API schema.
  assert.equal(Object.hasOwn(policy.required_status_checks, "contexts"), false);
  assert.deepEqual(policy.required_status_checks.checks.map(check => check.context), ["Release Gate",
    "Harness Cross-Platform (ubuntu-24.04)", "Harness Cross-Platform (macos-15)", "Harness Cross-Platform (windows-2025)", "Dependency Vulnerability Scan"]);
  assert.ok(policy.required_status_checks.checks.every(check => check.app_id === 15368));
});
