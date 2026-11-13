#!/usr/bin/env node

const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const os = require("os");
const { spawn, spawnSync } = require("child_process");
const { createProjectBootstrapCommand } = require("./project-bootstrap");
const { createProjectCommand } = require("./project-command");
const { createRequestCommand } = require("./request-command");
const { createExecutionCommand } = require("./execution-command");
const { createControlPlaneCommands } = require("./control-plane-command");
const { createDeploymentCommand } = require("./deployment-ledger");
const { appendHistory, createHistoryCommand, withHistory } = require("./work-history");
const { createAtlassianCommand } = require("./atlassian-command");
const { createAccountUsage } = require("./provider-account-usage");
const { checkProviders } = require("./provider-connection");
const { createFollowupCommand } = require("./operations-followup");
const { createBackupCommand } = require("./backup-command");
const { createStateTransitionNotifier } = require("./transition-notifier");
const { createProviderUsageService } = require("./provider-usage");
const { requestAgent } = require("./provider-request");
const { observedUsage } = require("./model-eval-oracle");
const { createModelEvalCommand } = require("./model-eval-command");
const { createPlanningEvalCommand } = require("./planning-eval");
const { selectModelRoute, taskAgentOptions } = require("./model-router");
const { validateMemoryDirectory } = require("./memory-governance");
const { createAgentRunnerCommand } = require("./agent-runner");
const { buildAgentContext, resolveAgentTaskScope } = require("./agent-context");
const { REPAIR_CONTRACT, validateRepairResponse } = require("./repair-evidence");
const { createPublicationHook } = require("./operations-publish");
const { repositoryContentFingerprint: calculateRepositoryContentFingerprint } = require("./content-fingerprint");
const { createDiagnosticCommands } = require("./diagnostic-commands");
const { printHelp } = require("./cli-help");
const { createCleanupManifest, findGeneratedPaths, isCleanupManifestValid } = require("./cleanup-utils");
const { createConfigLoader, isPlainObject } = require("./config");
const { sendNotification: deliverNotification } = require("./notification-utils");
const { blockActiveTask } = require("./task-blocker");
const { commandOrchestrate, requireTaskOrchestrationReady } = require("./orchestration-command");
const {
  createProfileVerificationSteps,
  createQuickProfileStep,
  createQuickCacheKey,
  detectVerificationProfiles,
  inferQuickMappings,
  selectQuickCommands,
  shouldBlockVerificationFailure,
  tokenizeCommand
} = require("./verify-utils");
const {
  dispatchCommand,
  getCommandMetadata,
  isRuntimeManagedEnv,
  shouldBypassConfig
} = require("./cli-entrypoint");
const { createAgentApiCommands } = require("./agent-api-command");
const { createEnvCheckCleanupCommands } = require("./env-check-cleanup-command");
const { createSingleRepoTaskCommands } = require("./single-repo-task-command");
const { createAutonomyRecoverCommands } = require("./autonomy-recover-command");
const { createVerifyCommands } = require("./verify-command");
const { isValidLocalTaskName, normalizeTaskName } = require("./task-format");

const ROOT = path.resolve(__dirname, "..", "..");
process.chdir(ROOT);

const VALID_TYPES = new Set(["feat", "fix", "refactor", "docs", "chore", "test", "experiment"]);
const VALID_ROLES = new Set([
  "orchestrator", "planner", "architect", "implementer", "reviewer",
  "verifier", "recorder", "memory", "release"
]);
const AUTO_FIX_ALLOWED_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".hpp", ".html",
  ".java", ".js", ".jsx", ".kt", ".php", ".py", ".rb", ".rs", ".scss",
  ".svelte", ".ts", ".tsx", ".vue",
]);
const AUTONOMY_STATE_REL = "observability/autonomy/state.json";
let providerRequestCount = 0;

function log(message = "") {
  process.stdout.write(`${message}\n`);
}

function fail(message, code = 1) {
  const err = new Error(message);
  err.code = code;
  throw err;
}

function ensureDir(dir) {
  fs.mkdirSync(path.join(ROOT, dir), { recursive: true });
}

function exists(relPath) {
  return fs.existsSync(path.join(ROOT, relPath));
}

function readText(relPath, fallback = "") {
  const file = path.join(ROOT, relPath);
  if (!fs.existsSync(file)) return fallback;
  return fs.readFileSync(file, "utf8");
}

function renderPrompt(relPath, variables = {}) {
  const template = readText(relPath);
  if (!template) fail(`Prompt template is missing or empty: ${relPath}`);
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, key) => {
    if (!(key in variables)) fail(`Prompt template variable is missing: ${key} in ${relPath}`);
    return String(variables[key]);
  });
}

function writeText(relPath, content) {
  const file = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content.endsWith("\n") ? content : `${content}\n`, "utf8");
}

function removeIfExists(relPath) {
  const target = path.join(ROOT, relPath);
  if (fs.existsSync(target)) fs.rmSync(target, { force: true });
}

function moveFile(fromRel, toRel) {
  const from = path.join(ROOT, fromRel);
  const to = path.join(ROOT, toRel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}

function normalizeRepoPath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/^[ab]\//, "");
}

function extractUnifiedDiff(text) {
  const fenced = text.match(/```(?:diff|patch)[ \t]*\r?\n([\s\S]*?)```/i)
    || text.match(/```[ \t]*\r?\n([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  const diffIndex = candidate.indexOf("diff --git ");
  if (diffIndex === -1) {
    fail("Auto-fix response did not contain a unified diff.");
  }
  return `${candidate.slice(diffIndex).trim()}\n`;
}

function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)```/i);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) fail("Agent response did not contain a JSON object.");
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (err) {
    fail(`Agent JSON response could not be parsed: ${err.message}`);
  }
}

function listTaskNames(folder) {
  const dir = path.join(ROOT, ".harness", "tasks", folder);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".md") && name !== ".gitkeep")
    .sort()
    .map((name) => name.replace(/\.md$/, "").normalize("NFC"));
}

function resolveTaskId({ strict = false } = {}) {
  const configured = String(process.env.TASK_ID || "").trim();
  if (configured && configured !== "local") return configured;
  const active = listTaskNames("active");
  if (active.length === 1) return active[0];
  if (strict && active.length > 1) {
    fail(`Multiple active tickets require an explicit task. Use --task <ticket> or set TASK_ID. Active: ${active.join(", ")}`);
  }
  const branchTask = getGitBranch().split("/").pop();
  if (branchTask && !["main", "master", "unknown", "HEAD"].includes(branchTask)) return branchTask;
  return configured || "local";
}

function applyExplicitTaskOption(options) {
  if (!options.task) return;
  const task = normalizeTaskName(options.task);
  if (!isValidLocalTaskName(task)) fail("--task must use safe ticket name characters (Korean/letters/numbers with hyphens)");
  const active = listTaskNames("active");
  if (active.length > 0 && !active.includes(task)) {
    fail(`Explicit task is not active: ${task}`);
  }
  process.env.TASK_ID = task;
}

function applyGitPatch(patchRel, reverse = false) {
  const checkArgs = ["apply", "--check"];
  if (reverse) checkArgs.push("-R");
  checkArgs.push(patchRel);
  const checked = run("git", checkArgs, { capture: true });
  if (checked.status !== 0) {
    fail(`Auto-fix patch ${reverse ? "rollback" : "validation"} failed: ${checked.stderr || checked.stdout}`);
  }

  const applyArgs = ["apply"];
  if (reverse) applyArgs.push("-R");
  applyArgs.push(patchRel);
  const applied = run("git", applyArgs, { capture: true });
  if (applied.status !== 0) {
    fail(`Auto-fix patch ${reverse ? "rollback" : "application"} failed: ${applied.stderr || applied.stdout}`);
  }
}

function run(command, args, options = {}) {
  const needsWindowsCommandShell = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command);
  const result = spawnSync(command, args, {
    cwd: options.cwd || ROOT,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    shell: needsWindowsCommandShell,
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });

  if (options.capture) {
    return {
      status: result.status ?? 1,
      stdout: result.stdout || "",
      stderr: result.stderr || "",
      error: result.error,
    };
  }

  return { status: result.status ?? 1, error: result.error };
}

function runAsync(command, args, options = {}) {
  return new Promise((resolve) => {
    const needsWindowsCommandShell = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command);
    const child = spawn(command, args, {
      cwd: ROOT,
      stdio: options.capture ? "pipe" : "inherit",
      shell: needsWindowsCommandShell,
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout.on("data", (chunk) => { stdout += chunk; });
      child.stderr.on("data", (chunk) => { stderr += chunk; });
    }
    child.on("error", (error) => resolve({ status: 1, stdout, stderr, error }));
    child.on("close", (status) => resolve({ status: status ?? 1, stdout, stderr }));
  });
}

function commandExists(command) {
  const pathExt = process.platform === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  const paths = (process.env.PATH || "").split(path.delimiter);
  const names = path.extname(command) ? [command] : pathExt.map((ext) => `${command}${ext.toLowerCase()}`).concat(pathExt.map((ext) => `${command}${ext}`));

  return paths.some((dir) => names.some((name) => fs.existsSync(path.join(dir, name))));
}

function parseEnvFile(relPath = ".env.local") {
  const envPath = path.join(ROOT, relPath);
  if (!fs.existsSync(envPath)) return {};

  const parsed = {};
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    value = value.replace(/^["']|["']$/g, "");
    parsed[key] = value;
    if (!process.env[key]) process.env[key] = value;
  }
  return parsed;
}

const loadConfig = createConfigLoader({ root: ROOT, fail });

async function sendNotification(status, message) {
  return deliverNotification({
    status,
    message,
    taskId: resolveTaskId(),
    env: process.env,
    fetchImpl: globalThis.fetch,
    log
  });
}

function runExternalGit(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" });
  return {
    status: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error
  };
}

function ensureEnvLocal() {
  const localPath = path.join(ROOT, ".env.local");
  const templatePath = path.join(ROOT, ".env.template");

  if (fs.existsSync(localPath)) {
    return { created: false, exists: true };
  }

  if (!fs.existsSync(templatePath)) {
    return { created: false, exists: false };
  }

  fs.copyFileSync(templatePath, localPath);
  return { created: true, exists: true };
}

function isPlaceholder(value) {
  return !value || value.startsWith("your_") || value === "sk-..." || value === "sk-ant-..." || value === "AIza...";
}

const providerUsage = createProviderUsageService({ root: ROOT, env: process.env, isPlaceholder });

function parseArgs(argv) {
  const positional = [];
  const options = {};

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith("--")) {
      positional.push(token);
      continue;
    }

    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      options[key] = true;
    } else {
      options[key] = next;
      i += 1;
    }
  }

  return { positional, options };
}

function currentTimestamp() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}

function fileTimestamp() {
  const now = new Date();
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
}

function getGitBranch() {
  const headPath = path.join(ROOT, ".git", "HEAD");
  if (fs.existsSync(headPath)) {
    const head = fs.readFileSync(headPath, "utf8").trim();
    const match = head.match(/^ref: refs\/heads\/(.+)$/);
    if (match) return match[1];
  }

  const result = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { capture: true });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function hasGitRemoteOrigin() {
  const configPath = path.join(ROOT, ".git", "config");
  if (fs.existsSync(configPath)) {
    return fs.readFileSync(configPath, "utf8").includes('[remote "origin"]');
  }

  return run("git", ["remote", "get-url", "origin"], { capture: true }).status === 0;
}

function gitPublishAction() {
  return hasGitRemoteOrigin() ? "commit and push" : "commit";
}

function reportMemoryFormat(output = log) {
  output("[Memory] Format/path lint only; factual accuracy and freshness are not verified.");
  try {
    const result = validateMemoryDirectory(ROOT);
    for (const item of result.files.filter(item => !item.ok)) output(`[Memory] ${item.file}: ${item.errors.join("; ")}`);
    output(`[Memory] ${result.ok ? "PASS" : "FAIL"}: ${result.checked} checked. Guide: docs/design-docs/memory-governance.md`);
    return result.ok;
  } catch (error) {
    output(`[Memory] FAIL: ${error.message}. Guide: docs/design-docs/memory-governance.md`);
    return false;
  }
}

function repositoryContentFingerprint() {
  return calculateRepositoryContentFingerprint(ROOT, runExternalGit);
}

const {
  commandContext,
  postJson,
  invokeBoundedAgent,
  commandRunAgent,
  commandProvider
} = createAgentApiCommands({
  ROOT,
  VALID_ROLES,
  parseEnvFile,
  parseArgs,
  applyExplicitTaskOption,
  resolveTaskId,
  fail,
  log,
  exists,
  readText,
  writeText,
  ensureDir,
  fileTimestamp,
  currentTimestamp,
  loadConfig,
  buildAgentContext,
  resolveAgentTaskScope,
  selectModelRoute,
  renderPrompt,
  requestAgent,
  observedUsage,
  providerUsage,
  checkProviders,
  createAccountUsage,
  isPlaceholder,
  getProviderRequestCount: () => providerRequestCount,
  setProviderRequestCount: value => { providerRequestCount = value; }
});

const {
  commandCheck,
  commandScanDrift,
  commandCleanup,
  recordCleanupCandidates
} = createEnvCheckCleanupCommands({
  ROOT,
  fs,
  path,
  crypto,
  log,
  fail,
  exists,
  readText,
  writeText,
  removeIfExists,
  ensureDir,
  run,
  commandExists,
  parseEnvFile,
  parseArgs,
  currentTimestamp,
  getGitBranch,
  hasGitRemoteOrigin,
  ensureEnvLocal,
  isPlaceholder,
  providerUsage,
  loadConfig,
  reportMemoryFormat,
  resolveTaskId,
  normalizeRepoPath,
  findGeneratedPaths,
  createCleanupManifest,
  isCleanupManifestValid,
  isPlainObject,
  isRuntimeManagedEnv
});

let validateAutoFixPatchRef = null;

const {
  verifyCurrentTicket,
  verifyCurrentTicketInProcess,
  dirtyPaths,
  requireCurrentVerifiedContent,
  getFullVerifyRecord,
  commandVerify
} = createVerifyCommands({
  ROOT,
  fs,
  os,
  crypto,
  path,
  parseEnvFile,
  parseArgs,
  applyExplicitTaskOption,
  resolveTaskId,
  fail,
  log,
  loadConfig,
  ensureDir,
  fileTimestamp,
  currentTimestamp,
  exists,
  readText,
  writeText,
  run,
  runAsync,
  reportMemoryFormat,
  repositoryContentFingerprint,
  sendNotification,
  extractUnifiedDiff,
  validateRepairResponse,
  REPAIR_CONTRACT,
  validateAutoFixPatch: patch => validateAutoFixPatchRef(patch),
  applyGitPatch,
  commandRunAgent,
  recordCleanupCandidates,
  tokenizeCommand,
  detectVerificationProfiles,
  inferQuickMappings,
  selectQuickCommands,
  createQuickCacheKey,
  createQuickProfileStep,
  createProfileVerificationSteps,
  shouldBlockVerificationFailure,
  blockActiveTask,
  isPlainObject
});

const {
  commandCreateTicket,
  commandStartTicket,
  commandCompleteTask,
  createPlannedTickets,
  ensureCurrentTicket
} = createSingleRepoTaskCommands({
  ROOT,
  VALID_TYPES,
  parseArgs,
  fail,
  log,
  exists,
  readText,
  writeText,
  moveFile,
  removeIfExists,
  listTaskNames,
  gitPublishAction,
  hasGitRemoteOrigin,
  run,
  currentTimestamp,
  requireTaskOrchestrationReady,
  getFullVerifyRecord,
  requireCurrentVerifiedContent,
  appendHistory
});

const {
  validateL5Patch,
  validateAutoFixPatch,
  assessRecovery,
  commandRecover,
  commandAutonomy
} = createAutonomyRecoverCommands({
  ROOT,
  path,
  AUTONOMY_STATE_REL,
  AUTO_FIX_ALLOWED_EXTENSIONS,
  parseEnvFile,
  parseArgs,
  fail,
  log,
  exists,
  readText,
  writeText,
  listTaskNames,
  loadConfig,
  normalizeRepoPath,
  extractUnifiedDiff,
  extractJson,
  applyGitPatch,
  run,
  currentTimestamp,
  fileTimestamp,
  gitPublishAction,
  ensureCurrentTicket,
  createPlannedTickets,
  verifyCurrentTicket,
  verifyCurrentTicketInProcess,
  dirtyPaths,
  getFullVerifyRecord,
  repositoryContentFingerprint,
  commandRunAgent,
  renderPrompt
});
validateAutoFixPatchRef = validateAutoFixPatch;

const commandProject = createProjectCommand({
  root: ROOT,
  parseArgs,
  runGit: runExternalGit,
  log
});

const commandBootstrap = createProjectBootstrapCommand({
  root: ROOT,
  parseArgs,
  runGit: runExternalGit,
  log
});

const commandExecution = createExecutionCommand({
  root: ROOT,
  parseArgs,
  reviewFingerprint: (worktree) => calculateRepositoryContentFingerprint(worktree, runExternalGit),
  runCommand: run,
  runGit: runExternalGit,
  tokenizeCommand,
  log
});
const commandRequest = createRequestCommand({
  root: ROOT,
  parseArgs,
  log,
  invokeAgent: invokeBoundedAgent,
  prepareExecution: commandExecution
});
const controlPlane = createControlPlaneCommands({
  root: ROOT,
  parseArgs,
  notify: (status, message, taskId, projectIds, deliveryState) => deliverNotification({ status, message, taskId, projectIds, deliveryState, env: process.env, fetchImpl: globalThis.fetch, log }),
  reviewFingerprint: (worktree) => calculateRepositoryContentFingerprint(worktree, runExternalGit),
  runGit: runExternalGit,
  checkAtlassian: () => createAtlassianCommand({ root: ROOT, parseArgs, log: () => {}, reviewFingerprint: worktree => calculateRepositoryContentFingerprint(worktree, runExternalGit) })(["check"]),
  log
});
const commandRunner = createAgentRunnerCommand({
  onProgress: id => publishManagedFollowups("runner", ["run", id]),
  root: ROOT,
  parseArgs,
  invokeAgent: (prompt, ticket) => commandRunAgent([...taskAgentOptions(ticket), prompt],
    {
      project_id: ticket.project_id,
      request_id: ticket.request_id,
      ticket_id: ticket.ticket_id,
      priority: ticket.priority,
      risk: ticket.risk,
      risk_source: ticket.risk_source,
      ticket_kind: ticket.ticket_kind,
      scope: ticket.scope,
      attempt: ticket.attempt,
      full_context: ticket.full_context,
      repair_required: ticket.repair_required
    }),
  notify: (status, message, taskId, projectIds, deliveryState) => deliverNotification({ status, message, taskId, projectIds, deliveryState, env: process.env, fetchImpl: globalThis.fetch, log }),
  reviewFingerprint: (worktree) => calculateRepositoryContentFingerprint(worktree, runExternalGit),
  runCommand: run,
  runGit: runExternalGit,
  tokenizeCommand,
  log
});
const commandDeployment = createDeploymentCommand({ root: ROOT, parseArgs, runGit: runExternalGit, log });
const commandBackup = createBackupCommand({ root: ROOT, parseArgs, log });
const commandModelEval = createModelEvalCommand({ root: ROOT, parseArgs, log, invokeAgent: invokeBoundedAgent });
const commandPlanningEval = args => createPlanningEvalCommand({ root: ROOT, parseArgs, log, invokeAgent: invokeBoundedAgent })(args);
const commandHistory = createHistoryCommand({ root: ROOT, parseArgs, log,
  reviewFingerprint: worktree => calculateRepositoryContentFingerprint(worktree, runExternalGit) });
const commandAtlassian = createAtlassianCommand({ root: ROOT, parseArgs, log,
  reviewFingerprint: worktree => calculateRepositoryContentFingerprint(worktree, runExternalGit) });
const commandOperations = createFollowupCommand({ root: ROOT, parseArgs, log, atlassian: commandAtlassian,
  reviewFingerprint: worktree => calculateRepositoryContentFingerprint(worktree, runExternalGit) });
const quietAtlassian = createAtlassianCommand({ root: ROOT, parseArgs, log: () => {},
  reviewFingerprint: worktree => calculateRepositoryContentFingerprint(worktree, runExternalGit) });
const publishManagedFollowups = createPublicationHook({ parseArgs, log,
  flush: createFollowupCommand({ root: ROOT, parseArgs, log: () => {}, atlassian: quietAtlassian,
    reviewFingerprint: worktree => calculateRepositoryContentFingerprint(worktree, runExternalGit) }) });
const notifyStateTransition = createStateTransitionNotifier({
  root: ROOT,
  parseArgs,
  notify: (status, message, taskId, projectIds, deliveryState) => deliverNotification({ status, message, taskId, projectIds, deliveryState,
    env: process.env, fetchImpl: globalThis.fetch, log: message => process.stderr.write(`${message}\n`) }),
  log: message => process.stderr.write(`${message}\n`)
});

function usage(args) { return printHelp(log, args); }

function checkGitPreflight() {
  if (!commandExists("git")) {
    fail("Git CLI is not installed or not available in the system PATH.");
  }
  const version = run("git", ["--version"], { capture: true });
  if (version.status !== 0 || version.error) {
    fail(`Git CLI could not be executed: ${version.error?.message || version.stderr || "unknown error"}`);
  }
  const isRepo = run("git", ["rev-parse", "--is-inside-work-tree"], { capture: true });
  if (isRepo.status !== 0 || isRepo.error) {
    fail("The current directory is not a Git repository. Please initialize git first.");
  }
}

async function commandOrchestrateFromCli(args) {
  const orchestrationArgs = parseArgs(args);
  if (!orchestrationArgs.options.capabilities) checkGitPreflight();
  const config = loadConfig();
  await commandOrchestrate({
    root: ROOT,
    args,
    config: {
      ...config.multiAgent,
      maxApiCalls: config.limits.maxApiCalls,
      maxRuntimeMinutes: config.limits.maxRuntimeMinutes,
      maxProviderRequests: config.api.maxProviderRequests,
      isFullVerifyCurrent: (task) => {
        const verifyRel = `observability/metrics/${task}.verify.json`;
        if (!exists(verifyRel)) return false;
        const verify = JSON.parse(readText(verifyRel));
        const full = getFullVerifyRecord(verify);
        if (full.result !== "pass") return false;
        try {
          requireCurrentVerifiedContent(task, full);
          return true;
        } catch {
          return false;
        }
      }
    },
    env: process.env,
    log,
    invokeAgent: async (role, prompt) => {
      const response = await commandRunAgent([
        "--execution-mode", "orchestrate",
        "--type", role === "architect" ? "architect" : "default",
        "--role", role,
        "--task", resolveTaskId({ strict: true }),
        prompt
      ]);
      return extractJson(response);
    }
  });
}

const { commandValidateAutoFix, commandValidateL5Patch, commandValidatePrompts, commandValidateApiRetry, commandValidateRecovery, commandValidateL5Soak } = createDiagnosticCommands({
  ROOT, parseArgs, fail, log, validateAutoFixPatch, validateL5Patch, renderPrompt, readText, VALID_ROLES, postJson, assessRecovery,
  getProviderRequestCount: () => providerRequestCount,
  setProviderRequestCount: value => { providerRequestCount = value; }
});

async function main(argv = process.argv.slice(2)) {
  const [command, ...args] = argv;
  const meta = getCommandMetadata(command || "help");
  if (!shouldBypassConfig(command)) {
    parseEnvFile();
    loadConfig();
  }
  if (meta.requiresGit) {
    checkGitPreflight();
  }
  const handlers = {
    memory: args => {
      if (args.length !== 1 || args[0] !== "check") fail("Usage: memory check");
      if (!reportMemoryFormat()) fail("Memory format validation failed");
    },
    notifications: async args => {
      const { positional, options } = parseArgs(args);
      const [action, id] = positional;
      if (Object.keys(options).length || (action === "list" ? positional.length !== 1 : action !== "retry" || positional.length !== 2)) {
        throw new Error("Usage: notifications list | notifications retry <event-id>");
      }
      const result = action === "list" ? notifyStateTransition.list() : await notifyStateTransition.retry(id);
      log(JSON.stringify(result, null, 2));
      return result;
    },
    cleanup: commandCleanup,
    check: commandCheck,
    "check-environment": commandCheck,
    "create-ticket": commandCreateTicket,
    bootstrap: commandBootstrap,
    project: commandProject,
    request: commandRequest,
    execution: commandExecution,
    runner: commandRunner,
    release: controlPlane.release,
    evidence: controlPlane.evidence,
    deployment: commandDeployment,
    dashboard: controlPlane.dashboard,
    history: commandHistory,
    atlassian: commandAtlassian,
    operations: commandOperations,
    backup: commandBackup,
    eval: args => args[0] === "planning" ? commandPlanningEval(args.slice(1)) : commandModelEval(args),
    "start-ticket": commandStartTicket,
    "complete-task": commandCompleteTask,
    verify: commandVerify,
    "run-agent": commandRunAgent,
    context: commandContext,
    provider: commandProvider,
    "scan-drift": commandScanDrift,
    recover: commandRecover,
    autonomy: commandAutonomy,
    orchestrate: commandOrchestrateFromCli,
    "validate-auto-fix": commandValidateAutoFix,
    "validate-l5-patch": commandValidateL5Patch,
    "validate-prompts": commandValidatePrompts,
    "validate-api-retry": commandValidateApiRetry,
    "validate-recovery": commandValidateRecovery,
    "validate-l5-soak": commandValidateL5Soak,
    help: usage,
    version: () => {
      const pkg = JSON.parse(readText("package.json"));
      log(pkg.version || "unknown");
    }
  };
  for (const name of ["request", "execution", "runner", "release", "deployment", "start-ticket", "complete-task", "verify"]) {
    handlers[name] = withHistory(ROOT, name, handlers[name]);
  }
  let handled;
  try { handled = await dispatchCommand(command, args, handlers, notifyStateTransition); }
  finally { if (handled || ["runner", "execution"].includes(command)) await publishManagedFollowups(command, args); }
  if (!handled) {
    usage();
    fail(`Unknown command: ${command}`);
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`[FAIL] ${error.message}\n`);
    const { inspectionAdvice, adviceText } = require("./safe-next-action");
    const advice = inspectionAdvice(process.argv[2] === "release" && process.argv[3] === "request" ? "request" : process.argv[2], process.argv[4]);
    if (advice) process.stderr.write(`${adviceText(advice)}\n`);
    process.exit(Number.isInteger(error.code) ? error.code : 1);
  });
}

module.exports = { main };
