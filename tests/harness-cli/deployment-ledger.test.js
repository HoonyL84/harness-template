"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createDeploymentCommand, normalizeDeployment, verifySourceReference } = require("../../tools/harness-cli/deployment-ledger");
const { emptyRegistry, writeRegistry } = require("../../tools/harness-cli/project-registry");

function parseArgs(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith("--")) positional.push(args[index]);
    else options[args[index].slice(2)] = args[index + 1] && !args[index + 1].startsWith("--") ? args[++index] : true;
  }
  return { positional, options };
}

test("deployment ledger records verified commits and remains append-only", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-deployment-"));
  const registry = emptyRegistry();
  registry.projects.demo = { id: "demo", path: path.join(root, "demo") };
  writeRegistry(path.join(root, ".harness", "local", "projects.json"), registry);
  const inputPath = path.join(root, "deployment.json");
  fs.writeFileSync(inputPath, JSON.stringify({ deployment_id: "prod-2026.08.30", project_id: "demo", environment: "production", status: "SUCCEEDED", source_branch: "main", source_commit: "abcdef1", deployed_at: "2026-08-30T12:00:00Z" }));
  const gitCalls = [];
  const command = createDeploymentCommand({ root, parseArgs, runGit: (args) => { gitCalls.push(args); return { status: 0 }; }, log: () => {} });
  const recorded = command(["record", "--file", inputPath]);
  assert.equal(recorded.deployment_id, "prod-2026.08.30");
  assert.deepEqual(gitCalls[0], ["cat-file", "-e", "abcdef1^{commit}"]);
  assert.equal(recorded.source_ref_verified, "refs/heads/main");
  assert.equal(command(["list", "--project", "demo"]).length, 1);
  assert.equal(command(["show", "prod-2026.08.30"]).source_branch, "main");
  assert.throws(() => command(["record", "--file", inputPath]), /already exists/);
});

test("deployment schema rejects unverifiable or unsafe records", () => {
  assert.throws(() => normalizeDeployment({ deployment_id: "BAD", status: "DONE" }), /Deployment id/);
  assert.throws(() => normalizeDeployment({ deployment_id: "bad", status: "SUCCEEDED", deployed_at: "bad" }), /deployed_at/);
  assert.throws(() => normalizeDeployment({ deployment_id: "bad", status: "SUCCEEDED", deployed_at: "2026-01-01", project_id: "p", environment: "prod", source_branch: "main", source_commit: "abcdef1", ci_url: "http://example.com" }), /HTTPS/);
  assert.throws(() => normalizeDeployment({ deployment_id: "rollback", status: "ROLLED_BACK", deployed_at: "2026-01-01", project_id: "p", environment: "prod", source_branch: "main", source_commit: "abcdef1" }), /rollback_of/);
  assert.throws(() => normalizeDeployment({ deployment_id: "bad-list", status: "SUCCEEDED", deployed_at: "2026-01-01", project_id: "p", environment: "prod", source_branch: "main", source_commit: "abcdef1", ticket_ids: "ticket" }), /must be an array/);
});

test("deployment source references fail closed on invalid branches and mismatched tags", () => {
  const record = { source_branch: "main", source_commit: "abcdef1", tag: null };
  assert.throws(() => verifySourceReference(() => ({ status: 1 }), ".", record), /valid Git branch/);
  assert.throws(() => verifySourceReference((args) => {
    if (args[0] === "check-ref-format" || args[0] === "rev-parse") return { status: 0, stdout: "ref" };
    return { status: 1 };
  }, ".", record), /not contained/);
  assert.throws(() => verifySourceReference((args) => {
    if (args[0] === "merge-base" || args[0] === "check-ref-format") return { status: 0 };
    if (args[0] === "rev-parse" && String(args[1]).startsWith("refs/heads")) return { status: 0, stdout: "branch" };
    return { status: 0, stdout: args[1].startsWith("refs/tags") ? "tag-sha" : "source-sha" };
  }, ".", { ...record, tag: "v1" }), /does not resolve/);
});
