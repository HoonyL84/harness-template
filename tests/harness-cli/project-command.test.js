"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProjectCommand } = require("../../tools/harness-cli/project-command");

function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (!argv[index].startsWith("--")) positional.push(argv[index]);
    else {
      const key = argv[index].slice(2);
      const next = argv[index + 1];
      options[key] = !next || next.startsWith("--") ? true : next;
      if (options[key] !== true) index += 1;
    }
  }
  return { positional, options };
}

test("project command registers, diagnoses, lists, and removes without changing the project", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-project-command-"));
  const projectPath = path.join(root, "demo-project");
  fs.mkdirSync(projectPath);
  fs.writeFileSync(path.join(projectPath, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  fs.writeFileSync(path.join(projectPath, "README.md"), "# Demo\n");
  const projectManifestBefore = fs.readFileSync(path.join(projectPath, "package.json"), "utf8");
  const logs = [];
  const runGit = (args) => {
    const command = args.join(" ");
    if (command === "rev-parse --show-toplevel") return { status: 0, stdout: `${projectPath}\n` };
    if (command === "rev-parse HEAD") return { status: 0, stdout: "abc123\n" };
    if (command === "branch --show-current") return { status: 0, stdout: "main\n" };
    if (command === "status --porcelain=v1 --untracked-files=all") return { status: 0, stdout: " M README.md\n" };
    if (command === "remote -v") return { status: 0, stdout: "origin\thttps://example/demo.git (fetch)\norigin\thttps://example/demo.git (push)\n" };
    return { status: 1, stderr: `Unexpected git command: ${command}` };
  };
  const command = createProjectCommand({ root, parseArgs, runGit, log: (line) => logs.push(line) });

  const added = command(["add", "demo", "--path", projectPath]);
  assert.equal(added.dirty, true);
  assert.equal(command(["list"])[0].id, "demo");
  assert.equal(command(["check", "demo"])[0].ok, true);
  assert.equal(command(["context", "demo"]).total_files, 1);
  assert.match(command(["context", "demo", "--bundle"]).content, /SOURCE: README.md/);
  assert.equal(command(["onboard", "demo"]).status, "DRAFT");
  assert.equal(command(["profile", "demo"]).project_id, "demo");
  assert.equal(command(["onboard", "demo", "--approve"]).status, "APPROVED");
  assert.match(command(["context", "demo", "--bundle"]).content, /ONBOARDING_PROFILE: APPROVED/);
  assert.equal(command(["remove", "demo"]).id, "demo");
  assert.equal(fs.readFileSync(path.join(projectPath, "package.json"), "utf8"), projectManifestBefore);
  assert.ok(logs.some((line) => line.includes("[REGISTERED] demo")));
});

test("project command handles empty, JSON, unknown, and failed diagnostics paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-project-command-errors-"));
  const projectPath = path.join(root, "demo-project");
  fs.mkdirSync(projectPath);
  const logs = [];
  let failStatus = false;
  const runGit = (args) => {
    const command = args.join(" ");
    if (failStatus && command === "rev-parse --show-toplevel") return { status: 1, stderr: "repository unavailable" };
    if (command === "rev-parse --show-toplevel") return { status: 0, stdout: `${projectPath}\n` };
    if (command === "rev-parse HEAD") return { status: 0, stdout: "abc123\n" };
    if (command === "branch --show-current") return { status: 0, stdout: "" };
    if (command === "status --porcelain=v1 --untracked-files=all") return { status: 0, stdout: "" };
    if (command === "remote -v") return { status: 1, stderr: "no remotes" };
    return { status: 1, stderr: "unexpected" };
  };
  const command = createProjectCommand({ root, parseArgs, runGit, log: (line) => logs.push(line) });

  assert.deepEqual(command(["list"]), []);
  assert.match(logs.at(-1), /No projects registered/);
  assert.throws(() => command(["add", "demo"]), /--path/);
  assert.equal(command(["add", "demo", "--path", projectPath, "--json"]).branch, "DETACHED");
  assert.equal(command(["show", "demo"]).id, "demo");
  assert.equal(command(["list", "--json"])[0].id, "demo");
  failStatus = true;
  assert.throws(() => command(["check", "demo", "--json"]), /failed diagnostics/);
  assert.throws(() => command(["show", "missing"]), /Unknown project/);
  assert.throws(() => command(["check", "missing"]), /Unknown project/);
  assert.throws(() => command(["remove", "missing"]), /Unknown project/);
  assert.throws(() => command(["invalid"]), /Usage/);
});
