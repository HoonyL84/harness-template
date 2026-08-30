"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readJson, updateJsonLocked } = require("./control-plane-state");
const { contextWarnings, discoverProjectContext } = require("./project-context");
const { createOnboardingProfile, writeOnboardingProfile } = require("./project-onboarding");
const { emptyRegistry, inspectGitProject, upsertProject, validateProjectId } = require("./project-registry");

const SCHEMA_VERSION = "1.0";
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 5 * 1024 * 1024;
const ALLOWED_ENV_TEMPLATES = new Set([".env.example", ".env.sample", ".env.template"]);
const SECRET_FILE_NAMES = new Set([
  ".npmrc", ".pypirc", "credentials", "credentials.json", "id_dsa", "id_ed25519", "id_rsa"
]);
const SECRET_PATTERNS = [
  /-----BEGIN (?:[A-Z ]+ )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/,
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/
];

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const comparablePath = (value) => {
  const normalized = path.normalize(path.resolve(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

function requireGitSuccess(runGit, args, cwd) {
  const result = runGit(args, cwd);
  if (result.error || result.status !== 0) {
    throw new Error(String(result.stderr || result.error?.message || `git ${args.join(" ")} failed`).trim());
  }
  return String(result.stdout || "");
}

function hasGitHead(runGit, projectPath) {
  const result = runGit(["rev-parse", "--verify", "HEAD"], projectPath);
  return !result.error && result.status === 0;
}

function ensureRepositoryRoot(runGit, projectPath, branch) {
  const absolutePath = path.resolve(projectPath);
  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isDirectory()) {
    throw new Error(`Bootstrap path is not a directory: ${absolutePath}`);
  }
  const root = runGit(["rev-parse", "--show-toplevel"], absolutePath);
  if (!root.error && root.status === 0) {
    const gitRoot = path.resolve(String(root.stdout || "").trim());
    if (comparablePath(gitRoot) !== comparablePath(absolutePath)) {
      throw new Error(`Bootstrap path is nested inside another Git repository: ${gitRoot}`);
    }
    return { path: absolutePath, initialized: false };
  }
  requireGitSuccess(runGit, ["init", "-b", branch], absolutePath);
  return { path: absolutePath, initialized: true };
}

function validateBootstrapPath(projectRoot, relativePath, limits) {
  const normalized = String(relativePath || "").replace(/\\/g, "/");
  const segments = normalized.split("/").filter(Boolean);
  if (!normalized || path.posix.isAbsolute(normalized) || segments.includes("..")) {
    throw new Error(`Bootstrap file escapes the project root: ${relativePath}`);
  }
  const absolutePath = path.resolve(projectRoot, normalized);
  const relative = path.relative(projectRoot, absolutePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Bootstrap file escapes the project root: ${relativePath}`);
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) throw new Error(`Bootstrap cannot commit a symlink or junction: ${normalized}`);
  if (!stat.isFile()) throw new Error(`Bootstrap candidate is not a regular file: ${normalized}`);
  const base = path.posix.basename(normalized).toLowerCase();
  if ((base === ".env" || base.startsWith(".env.")) && !ALLOWED_ENV_TEMPLATES.has(base)) {
    throw new Error(`Bootstrap cannot commit an environment secret file: ${normalized}`);
  }
  if (SECRET_FILE_NAMES.has(base) || base.endsWith(".pem") || base.endsWith(".key") || base.endsWith(".p12") || base.endsWith(".pfx")) {
    throw new Error(`Bootstrap cannot commit a credential file: ${normalized}`);
  }
  if (stat.size > limits.maxFileBytes) throw new Error(`Bootstrap file exceeds the size limit: ${normalized}`);
  const content = fs.readFileSync(absolutePath);
  if (!content.includes(0)) {
    const text = content.toString("utf8");
    if (SECRET_PATTERNS.some((pattern) => pattern.test(text))) throw new Error(`Bootstrap detected a likely secret in: ${normalized}`);
  }
  return { path: normalized, bytes: stat.size, sha256: hash(content) };
}

function createBootstrapSnapshot(projectRoot, runGit, options = {}) {
  const limits = {
    maxFileBytes: Number(options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES),
    maxTotalBytes: Number(options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES)
  };
  if (!Number.isFinite(limits.maxFileBytes) || limits.maxFileBytes < 1 || !Number.isFinite(limits.maxTotalBytes) || limits.maxTotalBytes < 1) {
    throw new Error("Bootstrap size limits must be positive numbers");
  }
  const output = requireGitSuccess(runGit, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], projectRoot);
  const paths = output.split("\0").filter(Boolean).sort();
  if (paths.length === 0) throw new Error("Bootstrap requires at least one non-ignored project file");
  const files = paths.map((filePath) => validateBootstrapPath(projectRoot, filePath, limits));
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);
  if (totalBytes > limits.maxTotalBytes) throw new Error(`Bootstrap files exceed the total size limit: ${totalBytes} bytes`);
  const fingerprint = hash(JSON.stringify(files));
  return { files, total_bytes: totalBytes, fingerprint };
}

function bootstrapPayload(input) {
  return {
    schema_version: SCHEMA_VERSION,
    bootstrap_id: input.bootstrap_id,
    project_id: input.project_id,
    project_path: input.project_path,
    branch: input.branch,
    summary: input.summary,
    commit_message: input.commit_message,
    snapshot: input.snapshot
  };
}

function createBootstrapRequest(input, now = new Date().toISOString()) {
  const payload = bootstrapPayload(input);
  if (!payload.summary || !payload.commit_message) throw new Error("Bootstrap requires a plan summary and commit message");
  return { ...payload, status: "PENDING", fingerprint: hash(JSON.stringify(payload)), requested_at: now, approved_at: null, consumed_at: null };
}

function approveBootstrap(record, fingerprint, now = new Date().toISOString()) {
  if (record.status !== "PENDING") throw new Error("Bootstrap approval is not pending");
  if (record.fingerprint !== fingerprint) throw new Error("Bootstrap approval fingerprint mismatch");
  return { ...record, status: "APPROVED", approved_at: now };
}

function beginBootstrap(record, fingerprint, now = new Date().toISOString()) {
  if (record.status !== "APPROVED" || record.consumed_at || record.fingerprint !== fingerprint) {
    throw new Error("Explicit unconsumed bootstrap approval is required");
  }
  return { ...record, status: "APPLYING", consumed_at: now };
}

function finishBootstrap(record, result, now = new Date().toISOString()) {
  if (record.status !== "APPLYING") throw new Error("Bootstrap is not applying");
  return { ...record, status: "APPLIED", applied_at: now, result };
}

function failBootstrap(record, error, result = null, now = new Date().toISOString()) {
  if (record.status !== "APPLYING") throw new Error("Bootstrap is not applying");
  return { ...record, status: "FAILED", failed_at: now, result: { error: String(error || "Unknown bootstrap failure"), partial_result: result } };
}

function registerAndDraftProfile({ root, projectId, diagnosis, runGit }) {
  const local = path.join(root, ".harness", "local");
  let project;
  updateJsonLocked(path.join(local, "projects.json"), emptyRegistry(), (registry) => {
    project = upsertProject(registry, projectId, diagnosis);
    return registry;
  });
  const files = discoverProjectContext(project.path);
  const profile = createOnboardingProfile(project, diagnosis, files, contextWarnings(files));
  writeOnboardingProfile(path.join(local, "profiles", `${projectId}.json`), profile);
  return { project, profile };
}

function createProjectBootstrapCommand({ root, parseArgs, runGit, log }) {
  const local = path.join(root, ".harness", "local");
  const recordPath = (id) => path.join(local, "bootstraps", `${validateProjectId(id)}.json`);

  return function commandBootstrap(args) {
    const { positional, options } = parseArgs(args);
    const [action, rawId] = positional;
    const id = validateProjectId(rawId);
    const file = recordPath(id);

    if (action === "status") {
      const record = readJson(file, null);
      if (!record) throw new Error(`Unknown bootstrap request: ${id}`);
      log(JSON.stringify(record, null, 2));
      return record;
    }
    if (action === "request") {
      if (!options.path || options.path === true) throw new Error("bootstrap request requires --path <project-root>");
      const summary = String(options.summary || "").trim();
      const message = String(options.message || "").trim();
      if (!summary || !message) throw new Error("bootstrap request requires --summary and --message");
      const branch = String(options.branch || "main").trim();
      if (!/^[A-Za-z0-9._/-]+$/.test(branch)) throw new Error("Bootstrap branch contains unsupported characters");
      const repository = ensureRepositoryRoot(runGit, options.path, branch);
      if (hasGitHead(runGit, repository.path)) {
        const diagnosis = inspectGitProject(repository.path, runGit);
        const result = registerAndDraftProfile({ root, projectId: id, diagnosis, runGit });
        const skipped = {
          schema_version: SCHEMA_VERSION,
          bootstrap_id: id,
          project_id: id,
          project_path: repository.path,
          status: "SKIPPED",
          reason: "existing-head",
          result: { head: diagnosis.head, profile_fingerprint: result.profile.content_fingerprint },
          recorded_at: new Date().toISOString()
        };
        updateJsonLocked(file, null, () => skipped);
        log(`[REGISTERED] ${id}: existing Git HEAD detected; initial commit skipped`);
        return skipped;
      }
      const snapshot = createBootstrapSnapshot(repository.path, runGit);
      const record = createBootstrapRequest({
        bootstrap_id: id,
        project_id: id,
        project_path: repository.path,
        branch,
        summary,
        commit_message: message,
        snapshot
      });
      updateJsonLocked(file, null, (existing) => {
        if (existing && !["PENDING", "FAILED"].includes(existing.status)) throw new Error(`Bootstrap request already exists: ${id}`);
        return record;
      });
      log(`[PLAN_COMMIT_APPROVAL_REQUIRED] ${id} ${record.fingerprint}`);
      return record;
    }

    const record = readJson(file, null);
    if (!record) throw new Error(`Unknown bootstrap request: ${id}`);
    if (action === "approve") {
      const approved = updateJsonLocked(file, null, (current) => approveBootstrap(current, options.fingerprint));
      log(`[APPROVED] ${id}`);
      return approved;
    }
    if (action === "apply") {
      const applying = updateJsonLocked(file, null, (current) => beginBootstrap(current, options.fingerprint));
      let partialResult = null;
      try {
        ensureRepositoryRoot(runGit, applying.project_path, applying.branch);
        if (hasGitHead(runGit, applying.project_path)) throw new Error("Bootstrap target already has a Git HEAD");
        const currentBranch = requireGitSuccess(runGit, ["symbolic-ref", "--short", "HEAD"], applying.project_path).trim();
        if (currentBranch !== applying.branch) throw new Error(`Bootstrap branch changed after approval: ${currentBranch}`);
        const snapshot = createBootstrapSnapshot(applying.project_path, runGit);
        if (snapshot.fingerprint !== applying.snapshot.fingerprint) throw new Error("Bootstrap files changed after plan approval");
        requireGitSuccess(runGit, ["add", "--all"], applying.project_path);
        const staged = requireGitSuccess(runGit, ["diff", "--cached", "--name-only", "-z"], applying.project_path).split("\0").filter(Boolean).sort();
        const approvedPaths = applying.snapshot.files.map((item) => item.path).sort();
        if (JSON.stringify(staged) !== JSON.stringify(approvedPaths)) throw new Error("Staged bootstrap files differ from the approved snapshot");
        requireGitSuccess(runGit, ["commit", "-m", applying.commit_message], applying.project_path);
        const commit = requireGitSuccess(runGit, ["rev-parse", "HEAD"], applying.project_path).trim();
        partialResult = { commit };
        const diagnosis = inspectGitProject(applying.project_path, runGit);
        const registered = registerAndDraftProfile({ root, projectId: applying.project_id, diagnosis, runGit });
        const result = { commit, profile_fingerprint: registered.profile.content_fingerprint, project_path: applying.project_path };
        const completed = updateJsonLocked(file, null, (current) => finishBootstrap(current, result));
        log(`[BOOTSTRAPPED] ${id} ${commit}`);
        return completed;
      } catch (error) {
        updateJsonLocked(file, null, (current) => failBootstrap(current, error.message, partialResult));
        throw error;
      }
    }
    throw new Error("Usage: bootstrap <request|approve|apply|status> <id>");
  };
}

module.exports = {
  approveBootstrap,
  beginBootstrap,
  createBootstrapRequest,
  createBootstrapSnapshot,
  createProjectBootstrapCommand,
  ensureRepositoryRoot,
  failBootstrap,
  finishBootstrap,
  hasGitHead
};
