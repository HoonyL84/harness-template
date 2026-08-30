"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SCHEMA_VERSION = "1.0";

function comparablePath(value) {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function emptyRegistry() {
  return { schema_version: SCHEMA_VERSION, projects: {} };
}

function validateProjectId(value) {
  const id = String(value || "").trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
    throw new Error("Project id must be kebab-case (for example: ad-server)");
  }
  return id;
}

function readRegistry(registryPath) {
  if (!fs.existsSync(registryPath)) return emptyRegistry();
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  } catch (error) {
    throw new Error(`Project registry is invalid JSON: ${error.message}`);
  }
  if (parsed?.schema_version !== SCHEMA_VERSION || !parsed.projects || typeof parsed.projects !== "object" || Array.isArray(parsed.projects)) {
    throw new Error(`Project registry must use schema_version ${SCHEMA_VERSION}`);
  }
  return parsed;
}

function writeRegistry(registryPath, registry) {
  fs.mkdirSync(path.dirname(registryPath), { recursive: true });
  const tempPath = `${registryPath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, registryPath);
}

function parseRemotes(output) {
  const remotes = {};
  for (const line of String(output || "").split(/\r?\n/)) {
    const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
    if (!match) continue;
    remotes[match[1]] ||= {};
    remotes[match[1]][match[3]] = match[2];
  }
  return remotes;
}

function worktreeFingerprint(projectRoot, statusOutput) {
  const entries = String(statusOutput || "").split(/\r?\n/).filter(Boolean).map((line) => {
    const rawPath = line.slice(3).replace(/^"|"$/g, "");
    const filePath = rawPath.includes(" -> ") ? rawPath.split(" -> ").at(-1) : rawPath;
    const absolute = path.resolve(projectRoot, filePath);
    let file = null;
    if (comparablePath(absolute).startsWith(`${comparablePath(projectRoot)}${path.sep}`) && fs.existsSync(absolute)) {
      const stat = fs.statSync(absolute);
      file = { size: stat.size, mtime_ms: Math.trunc(stat.mtimeMs), directory: stat.isDirectory() };
    }
    return { status: line.slice(0, 2), path: filePath.split(path.sep).join("/"), file };
  });
  return crypto.createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

function detectProjectProfile(projectPath) {
  const has = (name) => fs.existsSync(path.join(projectPath, name));
  const profiles = [];
  const verify = [];
  if (has("package.json")) {
    profiles.push("node");
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(projectPath, "package.json"), "utf8"));
      if (pkg.scripts?.test) verify.push("npm test");
      if (pkg.scripts?.lint) verify.push("npm run lint");
      if (pkg.scripts?.build) verify.push("npm run build");
    } catch {
      // Git diagnostics remain useful even when a project manifest is temporarily invalid.
    }
  }
  if (has("gradlew") || has("gradlew.bat") || has("build.gradle") || has("build.gradle.kts")) {
    profiles.push("gradle");
    verify.push(process.platform === "win32" && has("gradlew.bat") ? ".\\gradlew.bat test" : "./gradlew test");
  }
  if (has("pom.xml")) {
    profiles.push("maven");
    verify.push(has("mvnw") || has("mvnw.cmd") ? (process.platform === "win32" && has("mvnw.cmd") ? ".\\mvnw.cmd test" : "./mvnw test") : "mvn test");
  }
  if (has("pyproject.toml") || has("requirements.txt")) {
    profiles.push("python");
    verify.push("python -m pytest");
  }
  if (has("go.mod")) {
    profiles.push("go");
    verify.push("go test ./...");
  }
  if (has("Cargo.toml")) {
    profiles.push("rust");
    verify.push("cargo test");
  }
  if (fs.readdirSync(projectPath).some((name) => name.endsWith(".sln") || name.endsWith(".csproj"))) {
    profiles.push("dotnet");
    verify.push("dotnet test");
  }
  return { stacks: [...new Set(profiles)], verify_commands: [...new Set(verify)] };
}

function inspectGitProject(projectPath, runGit) {
  const absolutePath = path.resolve(projectPath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
    throw new Error(`Project path is not a directory: ${absolutePath}`);
  }
  const execute = (args) => {
    const result = runGit(args, absolutePath);
    if (result.error || result.status !== 0) {
      throw new Error(String(result.stderr || result.error?.message || `git ${args.join(" ")} failed`).trim());
    }
    return String(result.stdout || "").trim();
  };
  const gitRoot = path.resolve(execute(["rev-parse", "--show-toplevel"]));
  if (comparablePath(gitRoot) !== comparablePath(absolutePath)) {
    throw new Error(`Register the Git repository root instead: ${gitRoot}`);
  }
  const branchResult = runGit(["branch", "--show-current"], absolutePath);
  const head = execute(["rev-parse", "HEAD"]);
  const status = execute(["status", "--porcelain=v1", "--untracked-files=all"]);
  const remoteResult = runGit(["remote", "-v"], absolutePath);
  const profile = detectProjectProfile(absolutePath);
  return {
    path: absolutePath,
    git_root: gitRoot,
    branch: String(branchResult.stdout || "").trim() || "DETACHED",
    head,
    dirty: Boolean(status),
    changed_paths: status ? status.split(/\r?\n/).length : 0,
    worktree_fingerprint: worktreeFingerprint(absolutePath, status),
    remotes: remoteResult.status === 0 ? parseRemotes(remoteResult.stdout) : {},
    ...profile
  };
}

function upsertProject(registry, id, diagnosis, now = new Date().toISOString()) {
  const projectId = validateProjectId(id);
  const existing = registry.projects[projectId];
  if (existing && comparablePath(existing.path) !== comparablePath(diagnosis.path)) {
    throw new Error(`Project id already points to another path: ${existing.path}`);
  }
  registry.projects[projectId] = {
    id: projectId,
    name: path.basename(diagnosis.path),
    ...diagnosis,
    registered_at: existing?.registered_at || now,
    updated_at: now
  };
  return registry.projects[projectId];
}

function removeProject(registry, id) {
  const projectId = validateProjectId(id);
  if (!registry.projects[projectId]) throw new Error(`Unknown project: ${projectId}`);
  const removed = registry.projects[projectId];
  delete registry.projects[projectId];
  return removed;
}

module.exports = {
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
};
