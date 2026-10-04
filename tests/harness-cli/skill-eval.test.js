"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { gradeReviewCases, loadCases } = require("../../tools/harness-cli/skill-eval");

// Synthetic responses test the oracle, not an AI's review quality.
function responses() {
  return loadCases().map(c => ({
    id: c.id, selected_skill: c.expected.selected_skill, status: c.expected.status,
    findings: c.expected.findings.map(f => ({ severity: f.severities[0], file: f.file, line: f.line,
      explanation: "Synthetic fixture condition and impact.", suggestion: "Synthetic minimal correction." })),
    residual_risks: ["Not an actual model evaluation."], tests_run: [], limitations: ["No tests executed."]
  }));
}

test("skill oracle recognizes contracts but rejects missed defects and wrong routing", () => {
  const cases = loadCases(), rows = responses();
  assert.ok(gradeReviewCases(cases, rows).every(r => r.result === "PASS"));
  rows[0].findings = [];
  rows[5].selected_skill = "code-review";
  const results = gradeReviewCases(cases, rows);
  assert.match(results[0].errors.join(), /Missed known/);
  assert.match(results[5].errors.join(), /Wrong skill/);
  assert.equal(results[6].result, "PASS");
});

test("skill oracle rejects hallucinations, unsupported severity and missing limitations", () => {
  const cases = loadCases(), rows = responses();
  rows[3].findings = [{ severity: "P1", file: "src/unseen.js", line: 99, explanation: "guess", suggestion: "guess" }];
  rows[1].findings[0].severity = "warning";
  rows[2].limitations = [];
  rows[3].residual_risks = [];
  const results = gradeReviewCases(cases, rows);
  assert.match(results[3].errors.join(), /outside supplied diff/);
  assert.match(results[3].errors.join(), /Unexpected finding/);
  assert.match(results[1].errors.join(), /Findings require/);
  assert.match(results[2].errors.join(), /Unexecuted tests/);
});

test("skill oracle requires valid evidence and unique known IDs", () => {
  const cases = loadCases(), rows = responses();
  assert.throws(() => gradeReviewCases(cases, {}), /array/);
  assert.throws(() => gradeReviewCases(cases, [rows[0], rows[0]]), /Duplicate/);
  assert.throws(() => gradeReviewCases(cases, [{ id: "unknown" }]), /unknown/);
  assert.equal(gradeReviewCases(cases, [rows[0]])[1].result, "FAIL");
  for (const field of ["explanation", "suggestion", "file"]) {
    const copy = responses(); copy[0].findings[0][field] = "";
    assert.equal(gradeReviewCases(cases, copy)[0].result, "FAIL");
  }
  const copy = responses(); copy[3].residual_risks = [];
  assert.match(gradeReviewCases(cases, copy)[3].errors.join(), /residual risks/);
  copy[0].tests_run = "npm test";
  assert.match(gradeReviewCases(cases, copy)[0].errors.join(), /Invalid tests_run/);
});

test("offline CLI hides expected answers and fails incomplete responses without provider access", () => {
  const cli = path.resolve(__dirname, "../../tools/harness-cli/skill-eval.js");
  const list = spawnSync(process.execPath, [cli, "--cases"], { encoding: "utf8" });
  assert.equal(list.status, 0, list.stderr);
  const cases = JSON.parse(list.stdout);
  assert.ok(cases.length >= 6);
  assert.ok(cases.every(c => !Object.hasOwn(c, "expected") && typeof c.diff === "string"));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-eval-test-"));
  const file = path.join(root, "responses.json");
  fs.writeFileSync(file, "[]");
  const run = spawnSync(process.execPath, [cli, "--responses", file], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.ok(JSON.parse(run.stdout).results.every(r => r.result === "FAIL"));
  fs.writeFileSync(file, JSON.stringify(responses()));
  assert.equal(spawnSync(process.execPath, [cli, "--responses", file], { encoding: "utf8" }).status, 0);
  fs.writeFileSync(file, "{");
  assert.equal(spawnSync(process.execPath, [cli, "--responses", file], { encoding: "utf8" }).status, 1);
  fs.writeFileSync(file, "x".repeat(256 * 1024 + 1));
  assert.match(spawnSync(process.execPath, [cli, "--responses", file], { encoding: "utf8" }).stderr, /256KB/);
  assert.equal(spawnSync(process.execPath, [cli, "--unknown"], { encoding: "utf8" }).status, 1);
});
