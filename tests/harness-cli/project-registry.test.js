"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  detectProjectProfile,
  emptyRegistry,
  inspectGitProject,
  parseRemotes,
  readRegistry,
  removeProject,
  upsertProject,
  validateProjectId,
  worktreeFingerprint,
  writeRegistry
} = require("../../tools/harness-cli/project-registry");

test("project ids are stable kebab-case keys", () => {
  assert.equal(validateProjectId("ad-server"), "ad-server");
  assert.throws(() => validateProjectId("Ad Server"), /kebab-case/);
});

test("registry writes atomically and preserves registration time on refresh", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-projects-"));
  const registryPath = path.join(dir, "local", "projects.json");
  const registry = emptyRegistry();
  const diagnosis = { path: path.join(dir, "demo"), git_root: path.join(dir, "demo"), head: "abc123", branch: "main", dirty: false, changed_paths: 0, worktree_fingerprint: "clean", remotes: {}, stacks: ["node"], verify_commands: ["npm test"] };
  upsertProject(registry, "demo", diagnosis, "2026-01-01T00:00:00.000Z");
  upsertProject(registry, "demo", { ...diagnosis, dirty: true }, "2026-01-02T00:00:00.000Z");
  writeRegistry(registryPath, registry);
  const saved = readRegistry(registryPath).projects.demo;
  assert.equal(saved.registered_at, "2026-01-01T00:00:00.000Z");
  assert.equal(saved.updated_at, "2026-01-02T00:00:00.000Z");
  assert.equal(saved.dirty, true);
  assert.equal(fs.existsSync(`${registryPath}.tmp-${process.pid}`), false);
});

test("project id cannot be silently redirected and removal only changes metadata", () => {
  const registry = emptyRegistry();
  const diagnosis = { path: path.resolve("one"), git_root: path.resolve("one"), head: "abc123", branch: "main", dirty: false, changed_paths: 0, worktree_fingerprint: "clean", remotes: {}, stacks: [], verify_commands: [] };
  upsertProject(registry, "demo", diagnosis);
  assert.throws(() => upsertProject(registry, "demo", { ...diagnosis, path: path.resolve("two") }), /another path/);
  assert.equal(removeProject(registry, "demo").id, "demo");
  assert.deepEqual(registry.projects, {});
});

test("remote and stack detection expose actionable project metadata", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-profile-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test", lint: "eslint ." } }));
  fs.writeFileSync(path.join(dir, "build.gradle.kts"), "plugins {}\n");
  assert.deepEqual(parseRemotes("origin\thttps://example/repo.git (fetch)\norigin\tgit@example/repo.git (push)\n"), {
    origin: { fetch: "https://example/repo.git", push: "git@example/repo.git" }
  });
  const profile = detectProjectProfile(dir);
  assert.deepEqual(profile.stacks, ["node", "gradle"]);
  assert.ok(profile.verify_commands.includes("npm test"));
  assert.ok(profile.verify_commands.some((command) => command.includes("gradlew") || command === "./gradlew test"));
});

test("registry rejects corrupt JSON and unsupported schemas", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-registry-invalid-"));
  const registryPath = path.join(dir, "projects.json");
  fs.writeFileSync(registryPath, "{");
  assert.throws(() => readRegistry(registryPath), /invalid JSON/);
  fs.writeFileSync(registryPath, JSON.stringify({ schema_version: "2.0", projects: [] }));
  assert.throws(() => readRegistry(registryPath), /schema_version 1.0/);
});

test("stack detection covers supported non-Node project manifests", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-profile-all-"));
  for (const file of ["pom.xml", "mvnw.cmd", "pyproject.toml", "go.mod", "Cargo.toml", "demo.csproj"]) {
    fs.writeFileSync(path.join(dir, file), "\n");
  }
  const profile = detectProjectProfile(dir);
  assert.deepEqual(profile.stacks, ["maven", "python", "go", "rust", "dotnet"]);
  assert.ok(profile.verify_commands.includes("python -m pytest"));
  assert.ok(profile.verify_commands.includes("go test ./..."));
  assert.ok(profile.verify_commands.includes("cargo test"));
  assert.ok(profile.verify_commands.includes("dotnet test"));
});

test("Git inspection fails clearly for missing paths, nested roots, and Git errors", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-inspect-"));
  assert.throws(() => inspectGitProject(path.join(dir, "missing"), () => ({ status: 0 })), /not a directory/);
  assert.throws(
    () => inspectGitProject(dir, () => ({ status: 0, stdout: `${path.dirname(dir)}\n` })),
    /repository root/
  );
  assert.throws(
    () => inspectGitProject(dir, () => ({ status: 1, stderr: "not a repository" })),
    /not a repository/
  );
});

test("worktree fingerprint changes with tracked file metadata", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-worktree-fingerprint-"));
  const file = path.join(dir, "demo.txt");
  fs.writeFileSync(file, "one");
  const before = worktreeFingerprint(dir, " M demo.txt");
  fs.writeFileSync(file, "a longer value");
  const after = worktreeFingerprint(dir, " M demo.txt");
  assert.notEqual(before, after);
  assert.equal(worktreeFingerprint(dir, ""), worktreeFingerprint(dir, ""));
});
