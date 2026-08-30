"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { createProjectBootstrapCommand, createBootstrapSnapshot } = require("../../tools/harness-cli/project-bootstrap");

function parseArgs(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith("--")) positional.push(args[index]);
    else options[args[index].slice(2)] = args[index + 1] && !args[index + 1].startsWith("--") ? args[++index] : true;
  }
  return { positional, options };
}

function runGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
  return { status: result.status ?? 1, stdout: result.stdout || "", stderr: result.stderr || "", error: result.error };
}

function requireGit(t) {
  const result = runGit(["--version"], process.cwd());
  if (result.error || result.status !== 0) {
    t.skip(`Git unavailable in test environment: ${result.error?.message || result.stderr}`);
    return false;
  }
  return true;
}

function configureIdentity(repository) {
  assert.equal(runGit(["config", "user.name", "Harness Test"], repository).status, 0);
  assert.equal(runGit(["config", "user.email", "harness@example.invalid"], repository).status, 0);
}

test("bootstrap snapshot excludes ignored files and rejects secret files", (t) => {
  if (!requireGit(t)) return;
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-bootstrap-snapshot-"));
  assert.equal(runGit(["init", "-b", "main"], project).status, 0);
  fs.writeFileSync(path.join(project, ".gitignore"), "ignored.txt\n");
  fs.writeFileSync(path.join(project, "README.md"), "plan\n");
  fs.writeFileSync(path.join(project, "ignored.txt"), "private\n");
  const snapshot = createBootstrapSnapshot(project, runGit);
  assert.deepEqual(snapshot.files.map((file) => file.path), [".gitignore", "README.md"]);
  fs.writeFileSync(path.join(project, ".env.local"), "TOKEN=secret\n");
  assert.throws(() => createBootstrapSnapshot(project, runGit), /environment secret file/);
});

test("approved bootstrap creates exactly one initial commit and a draft onboarding profile", (t) => {
  if (!requireGit(t)) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-bootstrap-central-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-bootstrap-project-"));
  fs.writeFileSync(path.join(project, "README.md"), "# Approved plan\n");
  const command = createProjectBootstrapCommand({ root, parseArgs, runGit, log: () => {} });
  const pending = command(["request", "new-project", "--path", project, "--summary", "Approved plan", "--message", "docs: initial plan"]);
  assert.equal(pending.status, "PENDING");
  assert.notEqual(runGit(["rev-parse", "--verify", "HEAD"], project).status, 0);
  configureIdentity(project);
  command(["approve", "new-project", "--fingerprint", pending.fingerprint]);
  const applied = command(["apply", "new-project", "--fingerprint", pending.fingerprint]);
  assert.equal(applied.status, "APPLIED");
  assert.equal(runGit(["rev-list", "--count", "HEAD"], project).stdout.trim(), "1");
  const registry = JSON.parse(fs.readFileSync(path.join(root, ".harness", "local", "projects.json")));
  const profile = JSON.parse(fs.readFileSync(path.join(root, ".harness", "local", "profiles", "new-project.json")));
  assert.equal(registry.projects["new-project"].head, applied.result.commit);
  assert.equal(profile.status, "DRAFT");
  assert.throws(() => command(["apply", "new-project", "--fingerprint", pending.fingerprint]), /unconsumed bootstrap approval/);
});

test("bootstrap refuses changed plan files after approval", (t) => {
  if (!requireGit(t)) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-bootstrap-change-central-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-bootstrap-change-project-"));
  fs.writeFileSync(path.join(project, "README.md"), "first plan\n");
  const command = createProjectBootstrapCommand({ root, parseArgs, runGit, log: () => {} });
  const pending = command(["request", "changed-project", "--path", project, "--summary", "Plan", "--message", "docs: plan"]);
  configureIdentity(project);
  command(["approve", "changed-project", "--fingerprint", pending.fingerprint]);
  fs.writeFileSync(path.join(project, "README.md"), "changed after approval\n");
  assert.throws(() => command(["apply", "changed-project", "--fingerprint", pending.fingerprint]), /changed after plan approval/);
  assert.notEqual(runGit(["rev-parse", "--verify", "HEAD"], project).status, 0);
  assert.equal(command(["status", "changed-project"]).status, "FAILED");
});

test("existing repositories skip the initial commit and register immediately", (t) => {
  if (!requireGit(t)) return;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-bootstrap-existing-central-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "harness-bootstrap-existing-project-"));
  assert.equal(runGit(["init", "-b", "main"], project).status, 0);
  configureIdentity(project);
  fs.writeFileSync(path.join(project, "README.md"), "existing\n");
  assert.equal(runGit(["add", "README.md"], project).status, 0);
  assert.equal(runGit(["commit", "-m", "initial"], project).status, 0);
  const before = runGit(["rev-parse", "HEAD"], project).stdout.trim();
  const command = createProjectBootstrapCommand({ root, parseArgs, runGit, log: () => {} });
  const result = command(["request", "existing-project", "--path", project, "--summary", "Ignored for existing", "--message", "docs: unused"]);
  assert.equal(result.status, "SKIPPED");
  assert.equal(result.reason, "existing-head");
  assert.equal(runGit(["rev-parse", "HEAD"], project).stdout.trim(), before);
  assert.equal(runGit(["rev-list", "--count", "HEAD"], project).stdout.trim(), "1");
});
