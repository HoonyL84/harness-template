#!/usr/bin/env node

const fs = require("fs");
const crypto = require("crypto");
const http = require("http");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
process.chdir(ROOT);

const VALID_TYPES = new Set(["feat", "fix", "refactor", "docs", "chore", "test", "experiment"]);
const VALID_ROLES = new Set(["planner", "architect", "implementer", "reviewer", "verifier", "recorder", "memory", "release"]);
const AUTO_FIX_ALLOWED_ROOTS = new Set(["src", "app", "lib", "test", "tests", "__tests__"]);
const AUTO_FIX_ALLOWED_EXTENSIONS = new Set([
  ".c", ".cc", ".cpp", ".cs", ".css", ".go", ".h", ".hpp", ".html",
  ".java", ".js", ".jsx", ".kt", ".php", ".py", ".rb", ".rs", ".scss",
  ".svelte", ".ts", ".tsx", ".vue",
]);
const AUTO_FIX_FORBIDDEN_SEGMENTS = new Set([
  ".git", ".github", ".harness", ".venv", "build", "coverage", "dist", "docs",
  "evals", "infra", "memory", "migrations", "node_modules", "observability",
  "prompts", "scripts", "target", "terraform", "tools", "vendor", "venv",
]);
const AUTO_FIX_FORBIDDEN_FILES = new Set([
  ".env", ".env.local", "docker-compose.yml", "docker-compose.yaml", "dockerfile",
  "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
  "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts",
]);
const AUTONOMY_STATE_REL = "observability/autonomy/state.json";
const L5_PROTECTED_SEGMENTS = new Set([".git", ".harness", "observability", "node_modules", ".venv", "venv"]);
const L5_HIGH_RISK_SEGMENTS = new Set([
  ".github", "deploy", "deployment", "helm", "infra", "k8s", "kubernetes",
  "migrations", "scripts", "terraform",
]);
const L5_HIGH_RISK_FILES = new Set([
  ".env", ".env.local", "docker-compose.yml", "docker-compose.yaml", "dockerfile",
  "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
  "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts",
]);
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
  const fenced = text.match(/```(?:diff|patch)?\s*\n([\s\S]*?)```/i);
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
    .map((name) => name.replace(/\.md$/, ""));
}

function resolveTaskId({ strict = false } = {}) {
  const configured = String(process.env.TASK_ID || "").trim();
  if (configured && configured !== "local") return configured;
  const active = listTaskNames("active");
  if (active.length === 1) return active[0];
  const branchTask = getGitBranch().split("/").pop();
  if (branchTask && !["main", "master", "unknown", "HEAD"].includes(branchTask)) return branchTask;
  if (strict && active.length > 1) {
    fail(`Multiple active tickets require an explicit task. Use --task <ticket> or set TASK_ID. Active: ${active.join(", ")}`);
  }
  return configured || "local";
}

function applyExplicitTaskOption(options) {
  if (!options.task) return;
  const task = String(options.task).trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(task)) fail("--task must be a kebab-case ticket name");
  const active = listTaskNames("active");
  if (active.length > 0 && !active.includes(task)) {
    fail(`Explicit task is not active: ${task}`);
  }
  process.env.TASK_ID = task;
}

function readAutonomyState() {
  if (!exists(AUTONOMY_STATE_REL)) return {};
  try {
    return JSON.parse(readText(AUTONOMY_STATE_REL));
  } catch (err) {
    fail(`Autonomy state is invalid JSON: ${err.message}`);
  }
}

function writeAutonomyState(patch) {
  const previous = readAutonomyState();
  const next = { ...previous, ...patch, updated_at: currentTimestamp() };
  writeText(AUTONOMY_STATE_REL, JSON.stringify(next, null, 2));
  return next;
}

function validateL5Patch(patch) {
  patch = patch.replace(/^\uFEFF/, "");
  const maxBytes = Number(process.env.HARNESS_L5_MAX_PATCH_KB || "500") * 1000;
  const maxFiles = Number(process.env.HARNESS_L5_MAX_FILES || "20");
  if (!Number.isFinite(maxBytes) || maxBytes < 1 || Buffer.byteLength(patch, "utf8") > maxBytes) {
    fail(`L5 patch exceeds the ${maxBytes / 1000} KB limit.`);
  }

  const paths = [];
  const headerRegex = /^diff --git a\/(.+) b\/(.+)$/gm;
  let match;
  while ((match = headerRegex.exec(patch)) !== null) {
    const before = normalizeRepoPath(match[1]);
    const after = normalizeRepoPath(match[2]);
    if (before !== after) fail(`L5 patch cannot rename files automatically: ${before} -> ${after}`);
    paths.push(after);
  }

  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length === 0) fail("L5 patch does not contain file changes.");
  if (uniquePaths.length > maxFiles) fail(`L5 patch exceeds the ${maxFiles}-file limit.`);
  const fileHeaderPaths = [];
  const fileHeaderRegex = /^(?:---|\+\+\+) (?:[ab]\/(.+)|\/dev\/null)$/gm;
  while ((match = fileHeaderRegex.exec(patch)) !== null) {
    if (match[1]) fileHeaderPaths.push(normalizeRepoPath(match[1]));
  }
  if (fileHeaderPaths.some((filePath) => !uniquePaths.includes(filePath))) {
    fail("L5 patch contains file headers not declared by diff --git.");
  }
  if (/^(?:rename|copy) (?:from|to) /m.test(patch)) fail("L5 patch cannot rename or copy files automatically.");
  if (/^(?:GIT binary patch|Binary files )/m.test(patch)) fail("L5 patch cannot contain binary changes.");

  const highRisk = classifyL5Paths(uniquePaths);
  return { paths: uniquePaths, highRisk };
}

function classifyL5Paths(paths) {
  const highRisk = [];
  for (const filePath of paths) {
    const normalized = path.posix.normalize(filePath);
    const segments = normalized.split("/").map((segment) => segment.toLowerCase());
    const fileName = segments[segments.length - 1];
    const resolved = path.resolve(ROOT, normalized);
    if (normalized.startsWith("../") || (!resolved.startsWith(`${ROOT}${path.sep}`) && resolved !== ROOT)) {
      fail(`L5 patch escapes the repository: ${filePath}`);
    }
    if (segments.some((segment) => L5_PROTECTED_SEGMENTS.has(segment)) || fileName.startsWith(".env")) {
      fail(`L5 patch targets a protected harness or secret path: ${filePath}`);
    }
    if (segments.some((segment) => L5_HIGH_RISK_SEGMENTS.has(segment)) || L5_HIGH_RISK_FILES.has(fileName)) {
      highRisk.push(filePath);
    }
  }
  return [...new Set(highRisk)];
}

function validateAutoFixPatch(patch) {
  patch = patch.replace(/^\uFEFF/, "");

  if (Buffer.byteLength(patch, "utf8") > 100_000) {
    fail("Auto-fix patch exceeds the 100 KB safety limit.");
  }

  const paths = [];
  const headerRegex = /^diff --git a\/(.+) b\/(.+)$/gm;
  let match;
  while ((match = headerRegex.exec(patch)) !== null) {
    const before = normalizeRepoPath(match[1]);
    const after = normalizeRepoPath(match[2]);
    if (before !== after) {
      fail(`Auto-fix patch cannot rename files: ${before} -> ${after}`);
    }
    paths.push(after);
  }

  const headerPaths = [];
  const fileHeaderRegex = /^(?:---|\+\+\+) (?:[ab]\/(.+)|\/dev\/null)$/gm;
  while ((match = fileHeaderRegex.exec(patch)) !== null) {
    if (match[1]) headerPaths.push(normalizeRepoPath(match[1]));
  }

  if (paths.length === 0) {
    fail("Auto-fix patch does not contain any file changes.");
  }
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length > 5) {
    fail("Auto-fix patch exceeds the 5-file safety limit.");
  }
  if (/^(?:---|\+\+\+) \/dev\/null$/m.test(patch)) {
    fail("Auto-fix patch cannot create or delete files.");
  }
  if (/^(?:rename|copy) (?:from|to) /m.test(patch)) {
    fail("Auto-fix patch cannot rename or copy files.");
  }
  if (/^(?:old mode|new mode|new file mode|deleted file mode) /m.test(patch)) {
    fail("Auto-fix patch cannot change file modes.");
  }
  if (/^(?:GIT binary patch|Binary files )/m.test(patch)) {
    fail("Auto-fix patch cannot contain binary changes.");
  }
  if (headerPaths.some((filePath) => !uniquePaths.includes(filePath))) {
    fail("Auto-fix patch contains file headers not declared by diff --git.");
  }

  for (const filePath of uniquePaths) {
    const normalized = path.posix.normalize(filePath);
    const segments = normalized.split("/");
    const fileName = segments[segments.length - 1].toLowerCase();
    const extension = path.posix.extname(fileName).toLowerCase();
    const resolved = path.resolve(ROOT, normalized);

    if (normalized.startsWith("../") || (!resolved.startsWith(`${ROOT}${path.sep}`) && resolved !== ROOT)) {
      fail(`Auto-fix patch escapes the repository: ${filePath}`);
    }
    if (!segments.some((segment) => AUTO_FIX_ALLOWED_ROOTS.has(segment.toLowerCase()))) {
      fail(`Auto-fix path is outside low-risk source/test roots: ${filePath}`);
    }
    if (segments.some((segment) => AUTO_FIX_FORBIDDEN_SEGMENTS.has(segment.toLowerCase()))) {
      fail(`Auto-fix path contains a protected segment: ${filePath}`);
    }
    if (AUTO_FIX_FORBIDDEN_FILES.has(fileName) || fileName.startsWith(".env")) {
      fail(`Auto-fix cannot modify protected files: ${filePath}`);
    }
    if (!AUTO_FIX_ALLOWED_EXTENSIONS.has(extension)) {
      fail(`Auto-fix file type is not allowed: ${filePath}`);
    }
  }

  return uniquePaths;
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
    cwd: ROOT,
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

async function sendSlackNotification(status, message) {
  const webhook = process.env.SLACK_WEBHOOK_URL;
  if (!webhook || webhook.includes("YOUR/WEBHOOK/URL")) {
    log("  [Slack] 웹훅 미설정 — 알림 생략");
    return;
  }
  const color = status === "fail" ? "#ff0000" : "#36a64f";
  const taskId = resolveTaskId();
  const payload = {
    attachments: [{
      fallback: `Harness: ${message}`,
      color,
      title: `[Harness] Task: ${taskId}`,
      text: message,
      footer: "Harness Engineering",
      ts: Math.floor(Date.now() / 1000),
    }]
  };
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) log(`  [Slack] Notification HTTP failed: ${res.status}`);
  } catch (err) {
    log(`  [Slack] Notification exception: ${err.message}`);
  }
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

function getGitStatus() {
  const result = run("git", ["status", "--porcelain"], { capture: true });
  if (result.error) return null;
  return result.status === 0 ? result.stdout.trim() : "";
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

async function commandCheck() {
  let failed = 0;
  let warned = 0;
  const pass = (message) => log(`[PASS] ${message}`);
  const warn = (message) => {
    warned += 1;
    log(`[WARN] ${message}`);
  };
  const bad = (message) => {
    failed += 1;
    log(`[FAIL] ${message}`);
  };

  log("[Harness] Environment preflight started");

  const envState = ensureEnvLocal();
  if (envState.created) {
    pass(".env.local was created from .env.template");
    // Interactive setup helper
    if (process.stdout.isTTY) {
      const readline = require("readline");
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      
      const question = (query) => new Promise((resolve) => rl.question(query, resolve));
      
      const questionMasked = (query) => new Promise((resolve) => {
        let isMuted = false;
        const oldWrite = process.stdout.write;
        rl.question(query, (answer) => {
          process.stdout.write = oldWrite;
          isMuted = false;
          resolve(answer);
        });
        isMuted = true;
        process.stdout.write = function (chunk, encoding, callback) {
          if (isMuted) {
            // Mute typed keys by returning nothing or backspace, but let newline or query text pass
            if (chunk === "\n" || chunk === "\r\n" || chunk === "\r") {
              return oldWrite.call(process.stdout, chunk, encoding, callback);
            }
            if (chunk.includes(query)) {
              return oldWrite.call(process.stdout, chunk, encoding, callback);
            }
            return true;
          }
          return oldWrite.call(process.stdout, chunk, encoding, callback);
        };
      });
      
      log("\n⚙️  [Harness Setup] .env.local 설정 도우미");
      const wantSetup = await question("API Key를 입력하시겠습니까? (y/n, 기본값: n): ");
      if (wantSetup.toLowerCase().startsWith("y")) {
        const providerChoice = await question("AI Provider를 선택하세요 (openai/anthropic/gemini): ");
        const provider = ["openai", "anthropic", "gemini"].includes(providerChoice.toLowerCase()) ? providerChoice.toLowerCase() : "openai";
        
        log(`[${provider}] API Key를 입력하세요 (화면에는 표시되지 않습니다):`);
        const key = await questionMasked("> ");
        log(""); // Newline after muted input
        
        if (key && !isPlaceholder(key)) {
          let envContent = fs.readFileSync(path.join(ROOT, ".env.local"), "utf8");
          envContent = envContent.replace("HARNESS_AGENT_MODE=interactive", "HARNESS_AGENT_MODE=api");
          envContent = envContent.replace("AI_PROVIDER=openai", `AI_PROVIDER=${provider}`);
          if (provider === "openai") envContent = envContent.replace("OPENAI_API_KEY=sk-...", `OPENAI_API_KEY=${key}`);
          else if (provider === "anthropic") envContent = envContent.replace("ANTHROPIC_API_KEY=sk-ant-...", `ANTHROPIC_API_KEY=${key}`);
          else if (provider === "gemini") envContent = envContent.replace("GEMINI_API_KEY=AIza...", `GEMINI_API_KEY=${key}`);
          
          fs.writeFileSync(path.join(ROOT, ".env.local"), envContent, "utf8");
          log(`✅ [Harness Setup] API 모드 활성화 및 ${provider} 키 구성 완료!\n`);
        }
      }
      rl.close();
    }
  } else if (envState.exists) {
    pass(".env.local found");
  } else {
    warn(".env.local not found and .env.template is missing");
  }

  parseEnvFile();

  const mode = process.env.HARNESS_AGENT_MODE || "interactive";
  const provider = process.env.AI_PROVIDER || "openai";

  if (["interactive", "api"].includes(mode)) pass(`HARNESS_AGENT_MODE=${mode}`);
  else bad("HARNESS_AGENT_MODE must be interactive or api");

  const autonomyLevel = String(process.env.HARNESS_AUTONOMY_LEVEL || "4.5");
  if (autonomyLevel === "4.5") pass("HARNESS_AUTONOMY_LEVEL=4.5 (safe default)");
  else if (autonomyLevel === "5") warn("HARNESS_AUTONOMY_LEVEL=5 (Experimental opt-in)");
  else bad("HARNESS_AUTONOMY_LEVEL must be 4.5 or 5");

  const l5Defaults = {
    HARNESS_MAX_ITERATIONS: "3",
    HARNESS_MAX_API_CALLS: "6",
    HARNESS_MAX_RUNTIME_MINUTES: "30",
    HARNESS_L5_MAX_PATCH_KB: "500",
    HARNESS_L5_MAX_FILES: "20",
    HARNESS_API_MAX_RETRIES: "3",
    HARNESS_API_RETRY_BASE_MS: "1000",
    HARNESS_API_RETRY_MAX_MS: "30000",
    HARNESS_MAX_PROVIDER_REQUESTS: "12",
  };
  for (const [key, fallback] of Object.entries(l5Defaults)) {
    const value = Number(process.env[key] || fallback);
    if (Number.isFinite(value) && value > 0) pass(`${key}=${value}`);
    else bad(`${key} must be a positive number`);
  }

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  for (const command of ["git", "node", npmCommand]) {
    if (commandExists(command)) pass(`Command available: ${command}`);
    else bad(`Missing command: ${command}`);
  }

  if (mode === "api") {
    for (const command of ["curl", "jq"]) {
      if (commandExists(command)) pass(`API mode command available: ${command}`);
      else warn(`API mode compatibility note: ${command} not found. Node CLI run-agent does not require it, legacy shell scripts do.`);
    }

    if (provider === "openai") {
      if (isPlaceholder(process.env.OPENAI_API_KEY)) bad("AI_PROVIDER=openai but OPENAI_API_KEY is missing or placeholder");
      else pass("OpenAI key configured");
    } else if (provider === "anthropic") {
      if (isPlaceholder(process.env.ANTHROPIC_API_KEY)) bad("AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is missing or placeholder");
      else pass("Anthropic key configured");
    } else if (provider === "gemini") {
      if (isPlaceholder(process.env.GEMINI_API_KEY)) bad("AI_PROVIDER=gemini but GEMINI_API_KEY is missing or placeholder");
      else pass("Gemini key configured");
    } else {
      bad("AI_PROVIDER must be openai, anthropic, or gemini");
    }
  } else {
    pass("Interactive mode does not require provider API keys");
  }

  const insideGit = exists(".git") || run("git", ["rev-parse", "--is-inside-work-tree"], { capture: true }).status === 0;
  if (insideGit) {
    pass("Git repository detected");
    const currentBranch = getGitBranch();
    log(`[INFO] Current branch: ${currentBranch}`);
    if (autonomyLevel === "5" && process.env.HARNESS_AUTO_COMMIT === "true" && ["main", "master"].includes(currentBranch)) {
      bad("L5 auto-commit cannot run on main/master");
    }
    if (hasGitRemoteOrigin()) pass("Git remote origin configured");
    else warn("Git remote origin is not configured");

    const status = getGitStatus();
    if (status === null) warn("Git status could not be executed in this environment. Check working tree before switching machines.");
    else if (status) warn("Working tree has uncommitted changes. Commit or intentionally carry them before switching machines.");
    else pass("Working tree clean");
  } else {
    warn("Not inside a Git repository");
  }

  if (exists(".gitattributes")) pass(".gitattributes found for cross-OS line ending policy");
  else warn(".gitattributes missing. Shell scripts may drift between LF/CRLF across OSes.");

  if (exists("package.json")) {
    const pkg = JSON.parse(readText("package.json"));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const sdkDeps = ["openai", "@anthropic-ai/sdk", "@google/generative-ai", "@google/genai"].filter((name) => deps[name]);
    if (sdkDeps.length > 0) warn(`Provider SDK dependencies detected: ${sdkDeps.join(", ")}. Harness CLI is designed to use Node fetch directly.`);
    else pass("No provider SDK dependencies detected");
  }

  const activeDir = path.join(ROOT, ".harness", "tasks", "active");
  const activeCount = fs.existsSync(activeDir)
    ? fs.readdirSync(activeDir).filter((name) => name.endsWith(".md")).length
    : 0;
  if (activeCount > 1) warn(`Multiple active tickets detected: ${activeCount}. Use --task <ticket> or TASK_ID for verify/run-agent.`);
  else pass(`Active ticket count is safe: ${activeCount}`);

  log("----------------------------------------");
  log(`Environment preflight complete: fail=${failed} warn=${warned}`);
  process.exit(failed > 0 ? 1 : 0);
}

function commandCreateTicket(args) {
  const { positional, options } = parseArgs(args);
  const [name, type] = positional;
  if (!name || !type) fail("Usage: node tools/harness-cli/index.js create-ticket <name> <type> --goal \"...\"");
  if (!VALID_TYPES.has(type)) fail(`ticket type must be one of ${Array.from(VALID_TYPES).join(", ")}`);
  if (!options.goal) fail("--goal is required");

  const ticketRel = `.harness/tasks/backlog/${name}.md`;
  if (exists(ticketRel)) fail(`Ticket already exists: ${ticketRel}`);
  if (exists(`.harness/tasks/active/${name}.md`)) fail(`Active ticket already exists: .harness/tasks/active/${name}.md`);

  const content = `# TICKET: ${name}

## Type
${type}

## Goal
- ${options.goal}

## Scope
- ${options.scope || "[작성 필요]"}

## Out of Scope
- ${options["out-of-scope"] || "[작성 필요]"}

## Acceptance Criteria
- [ ] ${options.acceptance || "검증 기준 작성"}

## Risk
- ${options.risk || "낮음"}

## Notes
- Created from harness CLI.
`;

  writeText(ticketRel, content);
  log(`Created ticket: ${ticketRel}`);
}

function commandStartTicket(args) {
  const { positional, options } = parseArgs(args);
  const [name] = positional;
  if (!name) fail("Usage: node tools/harness-cli/index.js start-ticket <name> [--allow-parallel]");

  const backlogRel = `.harness/tasks/backlog/${name}.md`;
  const activeRel = `.harness/tasks/active/${name}.md`;
  const existingActive = listTaskNames("active");

  if (!exists(backlogRel)) fail(`Backlog ticket not found: ${backlogRel}`);
  if (exists(activeRel)) fail(`Active task already exists: ${activeRel}`);
  if (existingActive.length > 0 && !options["allow-parallel"]) {
    fail(`Another ticket is already active: ${existingActive.join(", ")}. Complete it first or retry with --allow-parallel.`);
  }

  moveFile(backlogRel, activeRel);
  log(`Promoted ticket to active: ${activeRel}`);
  const publishAction = gitPublishAction();
  log(`Next: implement, verify, ${publishAction}, run complete-task, then ${publishAction} completion metadata.`);
}

function commandCompleteTask(args) {
  const { positional, options } = parseArgs(args);
  const [name] = positional;
  if (!name) fail("Usage: node tools/harness-cli/index.js complete-task <name> [--force]");

  const verifyRel = `observability/metrics/${name}.verify.json`;
  const startRel = `observability/metrics/${name}.start.json`;
  const doneRel = `observability/metrics/${name}.done.json`;
  const activeRel = `.harness/tasks/active/${name}.md`;
  const archiveRel = `.harness/tasks/archive/${name}.md`;

  let verify = { result: "none", rework_count: 0, last_fail_reason: "none" };
  if (exists(verifyRel)) {
    verify = { ...verify, ...JSON.parse(readText(verifyRel)) };
  }

  if (!options.force && verify.result !== "pass") {
    fail("Task verification is not marked as pass. Re-run verification or use --force.");
  }
  if (!options.force) {
    requireCurrentVerifiedContent(name, verify);
  }

  let start = { started_at: "unknown", type: "unknown", project: "unknown" };
  if (exists(startRel)) {
    start = { ...start, ...JSON.parse(readText(startRel)) };
  }

  // Find exact branch name
  let branchName = "";
  if (start.type && start.type !== "unknown") {
    branchName = `${start.type}/${name}`;
  } else {
    const gitList = run("git", ["branch", "--list", `*/${name}`, `*${name}`], { capture: true });
    if (gitList.status === 0 && gitList.stdout.trim()) {
      branchName = gitList.stdout.replace(/\*/g, "").trim().split(/\s+/)[0];
    }
  }

  // Branch safety check: Compare local commit SHA with remote tracked commit SHA
  if (branchName && !options.force && hasGitRemoteOrigin()) {
    const localRef = run("git", ["rev-parse", "--quiet", "--verify", branchName], { capture: true });
    if (localRef.status === 0 && localRef.stdout.trim()) {
      const localSha = localRef.stdout.trim();
      const remoteRef = run("git", ["rev-parse", "--quiet", "--verify", `origin/${branchName}`], { capture: true });
      
      if (remoteRef.status !== 0 || remoteRef.stdout.trim() !== localSha) {
        fail(`Branch "${branchName}" has unpushed commits or is not synced with origin. Please push changes first, or complete with --force.`);
      }
    }
  }

  const worktreeRel = `.worktrees/${name}`;
  if (exists(worktreeRel)) {
    run("git", ["worktree", "remove", "-f", worktreeRel]);
    if (branchName) {
      run("git", ["branch", "-D", branchName], { capture: true });
    }
    for (const prefix of VALID_TYPES) {
      run("git", ["branch", "-D", `${prefix}/${name}`], { capture: true });
    }
    log("[Harness] Worktree removed");
  } else {
    log(`[Harness] Worktree not found: ${worktreeRel}`);
  }

  if (exists(activeRel)) {
    moveFile(activeRel, archiveRel);
    appendTaskCompletion(archiveRel, verify);
    log("[Harness] EXEC_PLAN archived");
  } else {
    log(`[Harness] EXEC_PLAN not found: ${activeRel}`);
  }

  // Already loaded 'start' info above

  writeText(doneRel, JSON.stringify({
    task: name,
    type: start.type || "unknown",
    project: start.project || "unknown",
    started_at: start.started_at || "unknown",
    completed_at: currentTimestamp(),
    rework_count: verify.rework_count || 0,
    last_fail_reason: verify.last_fail_reason || "none",
    verify_result: verify.result || "none",
  }, null, 2));

  removeIfExists(startRel);
  removeIfExists(verifyRel);

  log(`[Harness] Done metric written: ${doneRel}`);
  log("[Harness] Task complete.");
  log(`[Harness] Next: ${gitPublishAction()} the archived ticket and completion metadata.`);
}

function appendTaskCompletion(archiveRel, verify) {
  const current = readText(archiveRel);
  if (!current || current.includes("\n## Completion\n")) return;
  writeText(archiveRel, `${current.trimEnd()}

## Completion
- Completed At: ${currentTimestamp()}
- Verify Result: ${verify.result || "unknown"}
- Rework Count: ${verify.rework_count || 0}
- Last Failure: ${verify.last_fail_reason || "none"}
`);
}

function archiveVerifiedTicket(name) {
  const verifyRel = `observability/metrics/${name}.verify.json`;
  const startRel = `observability/metrics/${name}.start.json`;
  const doneRel = `observability/metrics/${name}.done.json`;
  const activeRel = `.harness/tasks/active/${name}.md`;
  const archiveRel = `.harness/tasks/archive/${name}.md`;
  const verify = exists(verifyRel) ? JSON.parse(readText(verifyRel)) : {};
  const start = exists(startRel) ? JSON.parse(readText(startRel)) : {};
  if (verify.result !== "pass") fail(`Cannot archive unverified L5 ticket: ${name}`);
  requireCurrentVerifiedContent(name, verify);
  if (exists(activeRel)) {
    moveFile(activeRel, archiveRel);
    appendTaskCompletion(archiveRel, verify);
  }
  writeText(doneRel, JSON.stringify({
    task: name,
    type: start.type || "unknown",
    project: start.project || "unknown",
    started_at: start.started_at || "unknown",
    completed_at: currentTimestamp(),
    rework_count: verify.rework_count || 0,
    last_fail_reason: verify.last_fail_reason || "none",
    verify_result: verify.result,
    completed_by: "l5-autonomy",
  }, null, 2));
  removeIfExists(startRel);
  removeIfExists(verifyRel);
}

function findFilesInDir(dir, filter, list = []) {
  if (!fs.existsSync(dir)) return list;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      if (file === "node_modules" || file === ".git" || file === ".worktrees") {
        continue;
      }
      findFilesInDir(filePath, filter, list);
    } else if (filter.test(filePath)) {
      list.push(filePath);
    }
  }
  return list;
}

function commandScanDrift(args) {
  const envTemplate = path.join(ROOT, ".env.template");
  if (!fs.existsSync(envTemplate)) {
    fail(".env.template not found. Cannot perform scan-drift.");
  }

  // Parse .env.template variables
  const templateContent = fs.readFileSync(envTemplate, "utf8");
  const templateVars = new Set();
  for (const line of templateContent.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Z_0-9]+)=/);
    if (match) {
      templateVars.add(match[1]);
    }
  }

  // Code variables scanner (searches process.env.VAR or System.getenv("VAR"))
  const files = findFilesInDir(ROOT, /\.(js|ts|java)$/);
  const codeVars = new Set();
  
  // Exclude system variables we do not trace
  const systemIgnore = new Set([
    "PATH", "PATHEXT", "PWD", "HOME", "SHELL", "USER", 
    "LANG", "PORT", "NODE_ENV", "TEMP", "TMP"
  ]);

  for (const file of files) {
    if (file.includes("node_modules") || file.includes(".worktrees")) continue;
    let content = fs.readFileSync(file, "utf8");
    
    // Strip comments to prevent matching placeholders in instructions
    content = content.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, "$1");

    // JS/TS: process.env.VARIABLE
    const jsRegex = /process\.env\.([A-Z_0-9]+)/g;
    let match;
    while ((match = jsRegex.exec(content)) !== null) {
      const v = match[1];
      if (!systemIgnore.has(v)) codeVars.add(v);
    }

    // Java: System.getenv("VARIABLE")
    const javaRegex = /System\.getenv\(\s*"([A-Z_0-9]+)"\s*\)/g;
    while ((match = javaRegex.exec(content)) !== null) {
      const v = match[1];
      if (!systemIgnore.has(v)) codeVars.add(v);
    }
  }

  const missing = [];
  for (const v of codeVars) {
    if (!templateVars.has(v)) {
      missing.push(v);
    }
  }

  if (missing.length > 0) {
    log(missing.join("\n"));
    process.exit(1);
  } else {
    log("✅ 이상 없음");
  }
}

function commandValidateAutoFix(args) {
  const { positional } = parseArgs(args);
  const [patchFile] = positional;
  if (!patchFile) {
    fail("Usage: node tools/harness-cli/index.js validate-auto-fix <patch-file>");
  }

  const patchPath = path.resolve(ROOT, patchFile);
  if (!patchPath.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(patchPath)) {
    fail(`Patch file not found inside repository: ${patchFile}`);
  }

  const patch = fs.readFileSync(patchPath, "utf8");
  const changedFiles = validateAutoFixPatch(patch);
  log(`Auto-fix patch policy passed: ${changedFiles.join(", ")}`);
}

function commandValidateL5Patch(args) {
  const { positional } = parseArgs(args);
  const [patchFile] = positional;
  if (!patchFile) fail("Usage: node tools/harness-cli/index.js validate-l5-patch <patch-file>");
  const patchPath = path.resolve(ROOT, patchFile);
  if (!patchPath.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(patchPath)) {
    fail(`Patch file not found inside repository: ${patchFile}`);
  }
  const result = validateL5Patch(fs.readFileSync(patchPath, "utf8"));
  log(`L5 patch policy passed: ${result.paths.join(", ")}`);
  if (result.highRisk.length > 0) log(`Approval required: ${result.highRisk.join(", ")}`);
}

function commandValidatePrompts() {
  renderPrompt("prompts/templates/agent-system.md", {
    CONTEXT: "context",
    ROLE: "implementer",
    ROLE_PROMPT: "role prompt",
    TYPE: "code",
  });
  renderPrompt("prompts/templates/l5-planner.md");
  renderPrompt("prompts/templates/l5-implementer.md", { TICKET: "example-ticket" });
  log("Prompt templates passed.");
}

async function commandValidateApiRetry() {
  const previous = {
    maxRetries: process.env.HARNESS_API_MAX_RETRIES,
    baseDelay: process.env.HARNESS_API_RETRY_BASE_MS,
    maxDelay: process.env.HARNESS_API_RETRY_MAX_MS,
    maxRequests: process.env.HARNESS_MAX_PROVIDER_REQUESTS,
    requestCount: providerRequestCount,
  };
  process.env.HARNESS_API_MAX_RETRIES = "2";
  process.env.HARNESS_API_RETRY_BASE_MS = "1";
  process.env.HARNESS_API_RETRY_MAX_MS = "5";
  process.env.HARNESS_MAX_PROVIDER_REQUESTS = "10";
  providerRequestCount = 0;

  let retryRequests = 0;
  let quotaRequests = 0;
  const server = http.createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/retry") {
      retryRequests += 1;
      if (retryRequests === 1) {
        res.statusCode = 503;
        res.setHeader("Retry-After", "0");
        res.end(JSON.stringify({ error: { code: "temporary_unavailable" } }));
      } else {
        res.statusCode = 200;
        res.end(JSON.stringify({ ok: true }));
      }
      return;
    }
    quotaRequests += 1;
    res.statusCode = 429;
    res.end(JSON.stringify({ error: { code: "insufficient_quota" } }));
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address();
    const retried = await postJson(`http://127.0.0.1:${port}/retry`, {}, { test: true });
    if (!retried.ok || retryRequests !== 2) fail("API retry self-test did not retry exactly once.");
    let quotaFailed = false;
    try {
      await postJson(`http://127.0.0.1:${port}/quota`, {}, { test: true });
    } catch (err) {
      quotaFailed = err.message.includes("insufficient_quota");
    }
    if (!quotaFailed || quotaRequests !== 1) fail("API quota self-test retried a non-retryable quota error.");
    log("API retry policy passed.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    const restore = (key, value) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("HARNESS_API_MAX_RETRIES", previous.maxRetries);
    restore("HARNESS_API_RETRY_BASE_MS", previous.baseDelay);
    restore("HARNESS_API_RETRY_MAX_MS", previous.maxDelay);
    restore("HARNESS_MAX_PROVIDER_REQUESTS", previous.maxRequests);
    providerRequestCount = previous.requestCount;
  }
}

function createPlannedTickets(plan) {
  if (!Array.isArray(plan.tasks) || plan.tasks.length === 0) {
    fail("Planner did not return any tasks.");
  }
  const created = [];
  for (const task of plan.tasks.slice(0, 20)) {
    const name = String(task.name || "").trim();
    const type = String(task.type || "feat").trim();
    const goal = String(task.description || task.goal || "").trim();
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || !VALID_TYPES.has(type) || !goal) {
      fail(`Planner returned an invalid ticket: ${JSON.stringify(task)}`);
    }
    if (exists(`.harness/tasks/backlog/${name}.md`) || exists(`.harness/tasks/active/${name}.md`) || exists(`.harness/tasks/archive/${name}.md`)) {
      continue;
    }
    commandCreateTicket([
      name,
      type,
      "--goal", goal,
      "--scope", `L5 planner가 분해한 '${plan.feature || "project goal"}' 하위 태스크`,
      "--out-of-scope", "현재 티켓 목표 밖의 독립 기능",
      "--acceptance", "티켓 목표가 구현되고 harness verify가 통과한다",
      "--risk", task.risk || "낮음",
    ]);
    created.push(name);
  }
  return created;
}

function ensureCurrentTicket() {
  const active = listTaskNames("active");
  if (active.length > 1) fail(`L5 requires one active ticket, found: ${active.join(", ")}`);
  if (active.length === 1) return active[0];
  const backlog = listTaskNames("backlog");
  if (backlog.length === 0) return "";
  commandStartTicket([backlog[0]]);
  return backlog[0];
}

function verifyCurrentTicket(ticket, autoFix) {
  const nodeArgs = [path.join("tools", "harness-cli", "index.js"), "verify"];
  if (autoFix) nodeArgs.push("--auto-fix");
  return run(process.execPath, nodeArgs, {
    capture: true,
    env: { TASK_ID: ticket, HARNESS_OFFLINE: "false" },
  });
}

async function verifyCurrentTicketInProcess(ticket, autoFix) {
  const previousTaskId = process.env.TASK_ID;
  const previousOffline = process.env.HARNESS_OFFLINE;
  process.env.TASK_ID = ticket;
  process.env.HARNESS_OFFLINE = "false";
  try {
    await commandVerify(autoFix ? ["--auto-fix"] : []);
  } finally {
    if (previousTaskId === undefined) delete process.env.TASK_ID;
    else process.env.TASK_ID = previousTaskId;
    if (previousOffline === undefined) delete process.env.HARNESS_OFFLINE;
    else process.env.HARNESS_OFFLINE = previousOffline;
  }
}

function dirtyPaths() {
  const result = run("git", ["status", "--porcelain"], { capture: true });
  if (result.status !== 0 || result.error) return null;
  return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim());
}

function worktreeSnapshot() {
  const diff = run("git", ["diff", "--binary", "HEAD"], { capture: true });
  const untracked = run("git", ["ls-files", "--others", "--exclude-standard", "-z"], { capture: true });
  if (diff.status !== 0 || diff.error || untracked.status !== 0 || untracked.error) return null;

  const untrackedPaths = untracked.stdout.split("\0").filter(Boolean).sort();
  const hash = crypto.createHash("sha256");
  hash.update(diff.stdout);
  for (const rel of untrackedPaths) {
    hash.update(`\0${rel}\0`);
    const absolute = path.join(ROOT, rel);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      hash.update(fs.readFileSync(absolute));
    }
  }
  return {
    fingerprint: hash.digest("hex"),
    paths: dirtyPaths() || [],
  };
}

function describeWorktreeDrift(before, after) {
  const beforePaths = new Set(before.paths);
  const newPaths = after.paths.filter((rel) => !beforePaths.has(rel));
  return newPaths.length > 0
    ? `verification changed the worktree: ${newPaths.slice(0, 10).join(", ")}`
    : "verification changed files that were already dirty";
}

function repositoryContentFingerprint() {
  const files = run("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], { capture: true });
  if (files.status !== 0 || files.error) return null;

  const hash = crypto.createHash("sha256");
  const paths = files.stdout.split("\0").filter(Boolean).sort();
  for (const rel of paths) {
    const absolute = path.join(ROOT, rel);
    if (!fs.existsSync(absolute)) continue;
    const stat = fs.lstatSync(absolute);
    hash.update(`\0${rel}\0`);
    if (stat.isSymbolicLink()) {
      hash.update(`link:${fs.readlinkSync(absolute)}`);
    } else if (stat.isFile()) {
      hash.update(fs.readFileSync(absolute));
    } else {
      hash.update("non-file");
    }
  }
  return hash.digest("hex");
}

function requireCurrentVerifiedContent(name, verify) {
  if (!verify.content_fingerprint) {
    fail(`Verification record for "${name}" predates content binding. Re-run verification.`);
  }
  const currentFingerprint = repositoryContentFingerprint();
  if (!currentFingerprint) {
    fail("Could not calculate the current repository content fingerprint.");
  }
  if (currentFingerprint !== verify.content_fingerprint) {
    fail(`Repository content changed after verification for "${name}". Re-run verification before completing the task.`);
  }
}

function gitHeadSha() {
  const result = run("git", ["rev-parse", "HEAD"], { capture: true });
  return result.status === 0 ? result.stdout.trim() : "unknown";
}

function recoveryCheckpoint(ticket, patchRel) {
  return {
    ticket,
    patch: patchRel,
    head_sha: gitHeadSha(),
    working_tree: dirtyPaths() || [],
    created_at: currentTimestamp(),
  };
}

async function commandAutonomy(args) {
  parseEnvFile();
  const { options } = parseArgs(args);
  const level = String(process.env.HARNESS_AUTONOMY_LEVEL || "4.5");
  const mode = process.env.HARNESS_AGENT_MODE || "interactive";
  const state = readAutonomyState();

  if (options.status) {
    log(JSON.stringify({
      level,
      mode,
      active: listTaskNames("active"),
      backlog: listTaskNames("backlog"),
      state,
    }, null, 2));
    return;
  }
  if (level !== "5") {
    fail("L5 is disabled. Set HARNESS_AUTONOMY_LEVEL=5 explicitly.");
  }

  const maxIterations = Number(options.iterations || process.env.HARNESS_MAX_ITERATIONS || "3");
  const maxApiCalls = Number(process.env.HARNESS_MAX_API_CALLS || "6");
  const maxMinutes = Number(process.env.HARNESS_MAX_RUNTIME_MINUTES || "30");
  if (![maxIterations, maxApiCalls, maxMinutes].every((value) => Number.isFinite(value) && value > 0)) {
    fail("L5 limits must be positive numbers.");
  }

  if (options["verify-current"]) {
    const ticket = state.current_ticket || listTaskNames("active")[0];
    if (!ticket) fail("No active L5 ticket to verify.");
    if (mode === "interactive") {
      await verifyCurrentTicketInProcess(ticket, true);
    } else {
      const result = verifyCurrentTicket(ticket, true);
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
      if (result.status !== 0) {
        const detail = result.error ? `: ${result.error.message}` : "";
        fail(`Verification failed for ${ticket}${detail}`, result.status);
      }
    }
    writeAutonomyState({ status: "verified", current_ticket: ticket, next_action: "review_and_complete" });
    return;
  }

  if (mode === "interactive") {
    const ticket = ensureCurrentTicket();
    const next = ticket ? "implement_and_verify" : "decompose_plan";
    writeAutonomyState({
      level: 5,
      mode,
      status: "awaiting_interactive_agent",
      current_ticket: ticket || null,
      next_action: next,
    });
    log("[L5 Experimental] Interactive session checkpoint");
    if (ticket) {
      log(`Current ticket: .harness/tasks/active/${ticket}.md`);
      log("Active agent instructions:");
      log("1. Read the active ticket and linked design documents.");
      log("2. Implement the ticket with surgical changes.");
      log(`3. Run: npm run harness -- autonomy --verify-current`);
      const publishAction = gitPublishAction();
      log(`4. ${publishAction} the verified diff, complete the task, then ${publishAction} completion metadata.`);
      log("5. Run autonomy again to continue with the next backlog ticket.");
    } else {
      log("No ticket is available. The active conversational agent must decompose docs/project/PLANS.md into backlog tickets, then run autonomy again.");
    }
    return;
  }

  if (mode !== "api") fail(`Unsupported HARNESS_AGENT_MODE for L5: ${mode}`);

  const initialDirty = dirtyPaths();
  if (initialDirty === null) fail("L5 API mode requires an executable git status command.");
  if (initialDirty.length > 0) {
    fail(`L5 API mode requires a clean worktree. Commit or stash first: ${initialDirty.slice(0, 10).join(", ")}`);
  }
  if (process.env.HARNESS_AUTO_COMMIT === "true") {
    const branch = getGitBranch();
    if (branch === "main" || branch === "master") {
      fail("L5 auto-commit is blocked on main/master. Switch to a task branch first.");
    }
  }

  const startedAt = Date.now();
  let apiCalls = 0;
  let completed = 0;
  let ticket = ensureCurrentTicket();

  if (!ticket) {
    if (apiCalls >= maxApiCalls) fail("L5 API call budget exhausted before planning.");
    const planText = await commandRunAgent([
      "--type", "architect", "--role", "planner",
      renderPrompt("prompts/templates/l5-planner.md"),
    ]);
    apiCalls += 1;
    const created = createPlannedTickets(extractJson(planText));
    if (created.length === 0) fail("L5 planner created no new tickets.");
    ticket = ensureCurrentTicket();
  }

  while (ticket && completed < maxIterations && apiCalls < maxApiCalls) {
    if ((Date.now() - startedAt) / 60_000 >= maxMinutes) {
      writeAutonomyState({ status: "budget_exhausted", current_ticket: ticket, reason: "runtime" });
      break;
    }

    process.env.TASK_ID = ticket;
    writeAutonomyState({
      level: 5,
      mode,
      status: "implementing",
      current_ticket: ticket,
      iteration: completed + 1,
      api_calls: apiCalls,
    });

    let patchRel = "";
    let patch = "";
    let patchInfo;
    const pendingApproval = state.status === "approval_required" && state.current_ticket === ticket && state.pending_patch;
    if (pendingApproval && options["approve-risk"]) {
      patchRel = state.pending_patch;
      patch = readText(patchRel);
      patchInfo = validateL5Patch(patch);
    } else {
      const response = await commandRunAgent([
        "--type", "code", "--role", "implementer",
        renderPrompt("prompts/templates/l5-implementer.md", { TICKET: ticket }),
      ]);
      apiCalls += 1;
      patch = extractUnifiedDiff(response);
      patchInfo = validateL5Patch(patch);
      patchRel = `observability/traces/${fileTimestamp()}-${ticket}-l5.patch`;
      writeText(patchRel, patch);
    }

    if (patchInfo.highRisk.length > 0 && !options["approve-risk"]) {
      writeAutonomyState({
        status: "approval_required",
        current_ticket: ticket,
        pending_patch: patchRel,
        high_risk_files: patchInfo.highRisk,
        next_action: "review patch and rerun autonomy --approve-risk",
      });
      log(`[L5 Experimental] Approval required: ${patchInfo.highRisk.join(", ")}`);
      return;
    }

    const checkpoint = recoveryCheckpoint(ticket, patchRel);
    writeAutonomyState({ status: "applying_patch", current_ticket: ticket, recovery_checkpoint: checkpoint });
    try {
      applyGitPatch(patchRel);
    } catch (err) {
      writeAutonomyState({
        status: "apply_failed",
        current_ticket: ticket,
        recovery_checkpoint: checkpoint,
        working_tree_after_failure: dirtyPaths(),
        recovery_instruction: `Inspect git status and patch; retry with: git apply --check "${patchRel}"`,
      });
      throw err;
    }
    const verify = verifyCurrentTicket(ticket, false);
    process.stdout.write(verify.stdout);
    process.stderr.write(verify.stderr);
    if (verify.status !== 0) {
      try {
        applyGitPatch(patchRel, true);
        writeAutonomyState({
          status: "failed_rolled_back",
          current_ticket: ticket,
          pending_patch: patchRel,
          recovery_checkpoint: checkpoint,
        });
      } catch (rollbackError) {
        writeAutonomyState({
          status: "rollback_failed",
          current_ticket: ticket,
          pending_patch: patchRel,
          recovery_checkpoint: checkpoint,
          working_tree_after_failure: dirtyPaths(),
          recovery_instruction: `Do not reset or clean automatically. Inspect changes, then try: git apply --check -R "${patchRel}"`,
        });
        fail(`L5 verification failed and non-destructive rollback also failed: ${rollbackError.message}`, verify.status);
      }
      fail(`L5 verification failed and the patch was rolled back: ${ticket}`, verify.status);
    }

    if (process.env.HARNESS_AUTO_COMMIT !== "true") {
      writeAutonomyState({
        status: "awaiting_review",
        current_ticket: ticket,
        verified_patch: patchRel,
        changed_files: patchInfo.paths,
        next_action: `${gitPublishAction()} the verified diff, complete the task, then ${gitPublishAction()} completion metadata`,
      });
      log(`[L5 Experimental] ${ticket} passed verification. Auto-commit is disabled, so execution paused for review.`);
      return;
    }

    const branch = getGitBranch();
    const currentPaths = dirtyPaths();
    if (currentPaths === null || currentPaths.length === 0) {
      fail("L5 verification passed but no working-tree changes were found to commit.");
    }
    const implementationPaths = currentPaths.filter((filePath) => !filePath.replace(/\\/g, "/").startsWith(".harness/tasks/"));
    const verifiedHighRisk = classifyL5Paths(implementationPaths);
    if (verifiedHighRisk.length > 0 && !options["approve-risk"]) {
      writeAutonomyState({
        status: "approval_required",
        current_ticket: ticket,
        pending_patch: patchRel,
        high_risk_files: verifiedHighRisk,
        next_action: "review verified changes and rerun autonomy --approve-risk",
      });
      return;
    }
    archiveVerifiedTicket(ticket);
    const verifiedPaths = dirtyPaths();
    if (verifiedPaths === null || verifiedPaths.length === 0) {
      fail("L5 could not find implementation and ticket metadata changes to commit.");
    }
    const addResult = run("git", ["add", "--", ...verifiedPaths], { capture: true });
    if (addResult.status !== 0) fail(`L5 could not stage files: ${addResult.stderr || addResult.stdout}`);
    const commitResult = run("git", ["commit", "-m", `feat(l5): ${ticket} 자율 작업 완료`], { capture: true });
    if (commitResult.status !== 0) fail(`L5 commit failed: ${commitResult.stderr || commitResult.stdout}`);
    if (process.env.HARNESS_AUTO_PUSH === "true") {
      const pushResult = run("git", ["push", "-u", "origin", branch], { capture: true });
      if (pushResult.status !== 0) fail(`L5 push failed: ${pushResult.stderr || pushResult.stdout}`);
    }

    completed += 1;
    writeAutonomyState({ status: "ticket_completed", current_ticket: ticket, completed_iterations: completed, api_calls: apiCalls });
    ticket = ensureCurrentTicket();
  }

  writeAutonomyState({
    status: ticket ? "budget_exhausted" : "goal_queue_complete",
    current_ticket: ticket || null,
    completed_iterations: completed,
    api_calls: apiCalls,
  });
  log(ticket
    ? `[L5 Experimental] Paused at configured budget. Next ticket: ${ticket}`
    : "[L5 Experimental] Backlog queue completed.");
}

function packageScripts() {
  if (!exists("package.json")) return {};
  return JSON.parse(readText("package.json")).scripts || {};
}

function recordVerify(result, reason, contentFingerprint) {
  const task = resolveTaskId();
  const rel = `observability/metrics/${task}.verify.json`;
  let reworkCount = 0;
  let lastFailReason = "";
  if (exists(rel)) {
    try {
      const previous = JSON.parse(readText(rel));
      reworkCount = previous.rework_count || 0;
      lastFailReason = previous.last_fail_reason || "";
    } catch {
      reworkCount = 0;
      lastFailReason = "";
    }
  }
  if (result === "fail") reworkCount += 1;
  if (reason) lastFailReason = reason;
  writeText(rel, JSON.stringify({
    task,
    last_verify: currentTimestamp(),
    result,
    ...(lastFailReason ? { last_fail_reason: lastFailReason } : {}),
    ...(contentFingerprint ? { content_fingerprint: contentFingerprint } : {}),
    rework_count: reworkCount,
  }, null, 2));
}

function summarizeVerifyFailure(failedStep) {
  const combined = `${failedStep.stderr || ""}\n${failedStep.stdout || ""}`;
  const lines = combined
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const detail = lines.find((line) => /assertionerror|exception|error:|\bfail(?:ed|ure)?\b/i.test(line))
    || lines[0]
    || `exit code ${failedStep.status}`;
  return `${failedStep.label}: ${detail}`.slice(0, 500);
}

async function commandVerify(args) {
  parseEnvFile();
  const { options } = parseArgs(args);
  applyExplicitTaskOption(options);
  resolveTaskId({ strict: true });
  const diagnose = options.diagnose || process.env.HARNESS_DIAGNOSE === "true";
  const autoFix = options["auto-fix"] || process.env.HARNESS_AUTO_FIX === "true";
  const offline = options.offline || process.env.HARNESS_OFFLINE === "1" || process.env.HARNESS_OFFLINE === "true";
  const maxAttempts = autoFix ? 2 : 1;
  let attempt = 0;
  let verifyPassed = false;
  let appliedPatchRel = "";

  ensureDir("observability/traces");
  ensureDir("observability/metrics");
  const logRel = `observability/traces/${fileTimestamp()}-verify.log`;
  const lines = [];
  const say = (message) => {
    lines.push(message);
    log(message);
  };

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const gradleCommand = process.platform === "win32" ? "gradlew.bat" : "./gradlew";

  while (attempt < maxAttempts && !verifyPassed) {
    const worktreeBefore = worktreeSnapshot();
    say(`[Harness] Verify execution started (Attempt ${attempt + 1}/${maxAttempts})`);
    if (offline) say("[OFFLINE] AI review skipped");

    let failedStep = null;
    const runStep = (label, command, stepArgs) => {
      say(`[${label}] ${command} ${stepArgs.join(" ")}`);
      // Run and capture outputs in case of failure for self-diagnosis
      const result = run(command, stepArgs, { capture: true });
      if (result.status !== 0) {
        failedStep = { label, command, stepArgs, status: result.status, stdout: result.stdout, stderr: result.stderr };
        return false;
      }
      return true;
    };

    let success = true;
    if (exists("build.gradle") || exists("build.gradle.kts")) {
      success = runStep("Java test", gradleCommand, ["test"]);
      const buildFiles = (exists("build.gradle") ? readText("build.gradle") : "") + "\n" + (exists("build.gradle.kts") ? readText("build.gradle.kts") : "");
      if (success && buildFiles.includes("jacoco")) {
        success = runStep("Java coverage", gradleCommand, ["jacocoTestCoverageVerification"]);
      }
      if (success) {
        success = runStep("Java build", gradleCommand, ["build", "-x", "test"]);
      }
    } else if (exists("package.json")) {
      const scripts = packageScripts();
      if (scripts.coverage) {
        success = runStep("Node coverage", npmCommand, ["run", "coverage"]);
      } else if (scripts.test) {
        success = runStep("Node test", npmCommand, ["run", "test"]);
      } else {
        say("[Node] Skipping tests (no test or coverage script)");
      }

      if (success && scripts.lint) {
        success = runStep("Node lint", npmCommand, ["run", "lint"]);
      } else if (success) {
        say("[Node] Skipping lint (no lint script)");
      }

      if (success && scripts.build) {
        success = runStep("Node build", npmCommand, ["run", "build"]);
      } else if (success) {
        say("[Node] Skipping build (no build script)");
      }
    } else {
      recordVerify("fail", "unsupported-project");
      fail("No supported project type detected. Please verify manually.");
    }

    if (worktreeBefore) {
      const worktreeAfter = worktreeSnapshot();
      if (worktreeAfter && worktreeAfter.fingerprint !== worktreeBefore.fingerprint) {
        const detail = describeWorktreeDrift(worktreeBefore, worktreeAfter);
        if (success) {
          failedStep = {
            label: "Worktree guard",
            command: "git",
            stepArgs: ["status", "--short"],
            status: 1,
            stdout: "",
            stderr: detail,
          };
          success = false;
        } else {
          say(`[Worktree guard] ${detail}`);
          failedStep.stderr = `${failedStep.stderr.trim()}\n[Worktree guard] ${detail}`.trim();
        }
      }
    }

    if (success) {
      verifyPassed = true;
      const contentFingerprint = repositoryContentFingerprint();
      if (!contentFingerprint) {
        recordVerify("fail", "repository-content-fingerprint-unavailable");
        fail("Verification passed, but the repository content fingerprint could not be calculated.");
      }
      recordVerify("pass", "", contentFingerprint);
      if (appliedPatchRel) {
        say(`[Auto-fix] Verification passed. Patch retained for review: ${appliedPatchRel}`);
        await sendSlackNotification("success", `✅ Low-risk auto-fix passed verification. Review patch: ${appliedPatchRel}`);
      }
      say("All checks passed. Safe to commit.");
      writeText(logRel, lines.join(os.EOL));
      break;
    }

    const failureReason = summarizeVerifyFailure(failedStep);
    say(`[Failure] ${failureReason}`);
    if (failedStep.stderr.trim()) {
      say(`[Failure stderr]\n${failedStep.stderr.trim().slice(-2000)}`);
    }
    if (failedStep.stdout.trim()) {
      say(`[Failure stdout]\n${failedStep.stdout.trim().slice(-1000)}`);
    }

    if (appliedPatchRel) {
      try {
        applyGitPatch(appliedPatchRel, true);
        say(`[Auto-fix] Verification still failed. Applied patch was rolled back: ${appliedPatchRel}`);
      } catch (err) {
        say(`[Auto-fix] CRITICAL: Automatic rollback failed: ${err.message}`);
      }
      recordVerify("fail", failureReason);
      writeText(logRel, lines.join(os.EOL));
      await sendSlackNotification("fail", `❌ Auto-fix failed verification and rollback was attempted.\nStep: ${failedStep.label}\nPatch: ${appliedPatchRel}`);
      process.exit(failedStep.status);
    }

    if (autoFix) {
      const mode = process.env.HARNESS_AGENT_MODE || "interactive";
      if (offline) {
        say("[Auto-fix] Disabled because offline mode is active.");
      } else if (mode !== "api") {
        say("[Auto-fix] Requires HARNESS_AGENT_MODE=api. Falling back to diagnosis guidance.");
      } else {
        const autoFixPrompt = `A verification step failed.
Step: ${failedStep.label}
Command: ${failedStep.command} ${failedStep.stepArgs.join(" ")}

Stderr:
${failedStep.stderr.slice(-3000)}

Stdout:
${failedStep.stdout.slice(-2000)}

Generate a minimal unified diff that fixes only the root cause.
Safety contract:
- Output only a unified diff, optionally inside a diff code fence.
- Change at most 5 files.
- Modify only existing low-risk source or test files in paths containing src/, app/, lib/, test/, tests/, or __tests__/.
- Do not modify configuration, dependencies, lockfiles, CI, scripts, infrastructure, database migrations, secrets, or documentation.
- Do not create, delete, or rename files.
- Avoid unrelated formatting or refactoring.`;

        try {
          say("[Auto-fix] Requesting one low-risk patch from the configured AI provider...");
          const response = await commandRunAgent(["--type", "fix", "--role", "implementer", autoFixPrompt]);
          const patch = extractUnifiedDiff(response);
          const changedFiles = validateAutoFixPatch(patch);
          appliedPatchRel = `observability/traces/${fileTimestamp()}-auto-fix.patch`;
          writeText(appliedPatchRel, patch);
          applyGitPatch(appliedPatchRel);
          say(`[Auto-fix] Patch applied to: ${changedFiles.join(", ")}`);
          say("[Auto-fix] Re-running verification once.");
          attempt++;
          continue;
        } catch (err) {
          say(`[Auto-fix] Patch generation or application rejected: ${err.message}`);
        }
      }
    }

    // If we failed and self-diagnose is requested
    if (diagnose && attempt < maxAttempts) {
      attempt++;
      const mode = process.env.HARNESS_AGENT_MODE || "interactive";
      if (mode !== "api") {
        say(`\n======================================================`);
        say(`🚨 [AGENT_COMMAND: SELF_DIAGNOSE_REQUIRED]`);
        say(`------------------------------------------------------`);
        say(`Verification step failed in interactive mode.`);
        say(`Step: ${failedStep.label}`);
        say(`Command: ${failedStep.command} ${failedStep.stepArgs.join(" ")}`);
        say(`\n[ERROR LOGS]`);
        say(`Stderr:\n${failedStep.stderr.slice(-2000)}`);
        say(`Stdout:\n${failedStep.stdout.slice(-1000)}`);
        say(`------------------------------------------------------`);
        say(`👉 INSTRUCTION FOR ACTIVE AGENT:`);
        say(`1. Analyze the verification failure details above.`);
        say(`2. Diagnose the root cause and propose recovery guidance.`);
        say(`3. Use codebase search / file write tools to fix the issue.`);
        say(`4. Once fixed, execute verification again using: npm run harness -- verify`);
        say(`======================================================\n`);
        recordVerify("fail", failureReason);
        writeText(logRel, lines.join(os.EOL));
        process.exit(failedStep.status);
      }

      say(`[Diagnose] Step "${failedStep.label}" failed. Initiating self-diagnosis (Attempt ${attempt}/${maxAttempts})...`);

      const diagnosePrompt = `The verification step "${failedStep.label}" failed during task execution.
Command executed: ${failedStep.command} ${failedStep.stepArgs.join(" ")}

Stderr Output:
${failedStep.stderr.slice(-2500)}

Stdout Output:
${failedStep.stdout.slice(-1500)}

Please review the error logs, identify the root cause, and write a detailed recovery guide explaining which files to edit, what lines to change, and how to fix the issue.`;

      try {
        await commandRunAgent(["--type", "review", "--role", "reviewer", diagnosePrompt]);
        say(`\nℹ️  [Diagnose] Recovery guide generated in agent log above. Please follow the instructions to resolve the error.`);
      } catch (err) {
        say(`[Diagnose] Self-diagnosis agent call failed: ${err.message}`);
      }

      // Exit immediately after generating the diagnose guidance in API mode
      recordVerify("fail", failureReason);
      writeText(logRel, lines.join(os.EOL));
      await sendSlackNotification("fail", `❌ Verification step [${failedStep.label}] failed.\nCommand: ${failedStep.command} ${failedStep.stepArgs.join(" ")}\nSelf-diagnosis completed. Recovery guide generated.`);
      process.exit(failedStep.status);
    } else {
      // Verification failed and no diagnose/exhausted attempts
      recordVerify("fail", failureReason);
      writeText(logRel, lines.join(os.EOL));
      await sendSlackNotification("fail", `❌ Verification step [${failedStep.label}] failed.\nCommand: ${failedStep.command} ${failedStep.stepArgs.join(" ")}\nSelf-diagnosis is disabled or completed.`);
      process.exit(failedStep.status);
    }
  }
}

function inferRole(type) {
  if (type === "architect") return "architect";
  if (type === "review") return "reviewer";
  if (type === "docs") return "recorder";
  return "implementer";
}

function selectModel(provider, type) {
  if (provider === "openai") {
    if (type === "code" || type === "docs") return process.env.OPENAI_MODEL_FAST || "gpt-5-mini";
    if (type === "architect") return process.env.OPENAI_MODEL_STRONG || "gpt-5.2";
    return process.env.OPENAI_MODEL || "gpt-5.2";
  }
  if (provider === "anthropic") {
    if (type === "code" || type === "docs") return process.env.ANTHROPIC_MODEL_FAST || "claude-haiku-4-5";
    if (type === "architect") return process.env.ANTHROPIC_MODEL_STRONG || "claude-opus-4-7";
    return process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
  }
  if (provider === "gemini") {
    if (type === "architect") return process.env.GEMINI_MODEL_STRONG || "gemini-3-1-pro";
    if (type === "code" || type === "docs") return process.env.GEMINI_MODEL_FAST || "gemini-3-flash";
    return process.env.GEMINI_MODEL || "gemini-3-flash";
  }
  fail(`Unsupported provider: ${provider}`);
}

function buildContextBundle(type, taskName) {
  const blocks = [
    ["Agent Rules", "AGENTS.md", 300],
    ["Project Plan", "docs/project/PLANS.md", 250],
    ["Core Beliefs", "docs/design-docs/core-beliefs.md", 250],
    ["Tech Stack", "docs/design-docs/tech-stack.md", 200],
    ["Agent Roles", "docs/design-docs/agent-roles.md", 220],
    ["Execution Modes", "docs/design-docs/execution-modes.md", 220],
    ["Auto-fix Policy", "docs/design-docs/auto-fix-policy.md", 220],
    ["L5 Autonomy Policy", "docs/design-docs/l5-autonomy-policy.md", 260],
  ];
  const out = [`# Harness Context Bundle`, `GeneratedAt: ${currentTimestamp()}`, `TaskType: ${type}`, `TaskName: ${taskName || "unknown"}`, ""];
  for (const [title, rel, maxLines] of blocks) {
    const content = readText(rel, `[MISSING] ${rel}`).split(/\r?\n/).slice(0, maxLines).join("\n");
    out.push(`=== ${title} (${rel}) ===`, content, "");
  }
  const activeRel = taskName ? `.harness/tasks/active/${taskName}.md` : "";
  if (activeRel) out.push(`=== Active Task EXEC_PLAN (${activeRel}) ===`, readText(activeRel, `[MISSING] ${activeRel}`), "");
  return out.join("\n");
}

async function postJson(url, headers, body) {
  if (typeof fetch !== "function") fail("Node fetch is unavailable. Use Node.js 18+.");
  const maxRetries = Number(process.env.HARNESS_API_MAX_RETRIES || "3");
  const baseDelayMs = Number(process.env.HARNESS_API_RETRY_BASE_MS || "1000");
  const maxDelayMs = Number(process.env.HARNESS_API_RETRY_MAX_MS || "30000");
  const maxProviderRequests = Number(process.env.HARNESS_MAX_PROVIDER_REQUESTS || "12");
  if (![maxRetries, baseDelayMs, maxDelayMs].every((value) => Number.isFinite(value) && value >= 0)
      || !Number.isFinite(maxProviderRequests) || maxProviderRequests < 1) {
    fail("API retry settings must be non-negative, and HARNESS_MAX_PROVIDER_REQUESTS must be at least 1.");
  }

  const retryableStatus = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      if (providerRequestCount >= maxProviderRequests) {
        const budgetError = new Error(`Provider request budget exhausted: ${providerRequestCount}/${maxProviderRequests}`);
        budgetError.code = 1;
        budgetError.noRetry = true;
        throw budgetError;
      }
      providerRequestCount += 1;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
      const json = await response.json().catch(() => ({}));
      if (response.ok) return json;

      const details = JSON.stringify(json);
      const providerCode = String(json.error?.code || json.error?.type || "").toLowerCase();
      const quotaExhausted = ["insufficient_quota", "billing_hard_limit_reached", "credit_balance_too_low"]
        .some((code) => providerCode.includes(code));
      if (quotaExhausted || !retryableStatus.has(response.status) || attempt === maxRetries) {
        const apiError = new Error(`API request failed (${response.status}): ${details}`);
        apiError.code = 1;
        apiError.noRetry = true;
        throw apiError;
      }

      const retryAfter = response.headers.get("retry-after");
      let delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
      if (retryAfter) {
        const seconds = Number(retryAfter);
        const dateDelay = Date.parse(retryAfter) - Date.now();
        const requestedDelay = Number.isFinite(seconds) ? seconds * 1000 : dateDelay;
        if (Number.isFinite(requestedDelay) && requestedDelay >= 0) {
          delayMs = Math.min(maxDelayMs, requestedDelay);
        }
      }
      log(`[API] Retryable HTTP ${response.status}. Retrying in ${delayMs}ms (${attempt + 1}/${maxRetries}).`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (err) {
      if (err.noRetry || attempt === maxRetries) throw err;
      const delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
      log(`[API] Network error: ${err.message}. Retrying in ${delayMs}ms (${attempt + 1}/${maxRetries}).`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  fail("API request exhausted retry attempts.");
}

async function commandRunAgent(args) {
  parseEnvFile();
  const { positional, options } = parseArgs(args);
  applyExplicitTaskOption(options);
  const prompt = positional.join(" ").trim();
  if (!prompt) fail("Usage: node tools/harness-cli/index.js run-agent [--type code|architect|review|docs] [--role role] \"prompt\"");

  if ((process.env.HARNESS_AGENT_MODE || "interactive") !== "api") {
    fail("HARNESS_AGENT_MODE must be api to call provider APIs directly.");
  }

  const type = options.type || "default";
  const role = options.role || inferRole(type);
  if (!VALID_ROLES.has(role)) fail(`Unsupported role: ${role}`);

  const provider = process.env.AI_PROVIDER || "openai";
  const model = selectModel(provider, type);
  const taskName = resolveTaskId({ strict: true });
  const rolePrompt = readText(`prompts/system/roles/${role}.md`);
  const context = buildContextBundle(type, taskName);
  const systemPrompt = renderPrompt("prompts/templates/agent-system.md", {
    CONTEXT: context,
    ROLE: role,
    ROLE_PROMPT: rolePrompt,
    TYPE: type,
  });

  ensureDir("observability/traces");
  const logRel = `observability/traces/${fileTimestamp()}-${type}.log`;
  log("🤖 [Harness Agent]");
  log(`   Provider : ${provider}`);
  log(`   Model    : ${model}`);
  log(`   Role     : ${role}`);
  log(`   Task     : ${prompt}`);
  log(`   Log      : ${logRel}`);

  let text = "";
  if (provider === "openai") {
    if (isPlaceholder(process.env.OPENAI_API_KEY)) fail("OPENAI_API_KEY is missing or placeholder");
    const json = await postJson("https://api.openai.com/v1/chat/completions", {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    }, {
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
    });
    text = json.choices?.[0]?.message?.content || "";
  } else if (provider === "anthropic") {
    if (isPlaceholder(process.env.ANTHROPIC_API_KEY)) fail("ANTHROPIC_API_KEY is missing or placeholder");
    const json = await postJson("https://api.anthropic.com/v1/messages", {
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    }, {
      model,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });
    text = json.content?.[0]?.text || "";
  } else if (provider === "gemini") {
    if (isPlaceholder(process.env.GEMINI_API_KEY)) fail("GEMINI_API_KEY is missing or placeholder");
    const json = await postJson(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {}, {
      contents: [{ parts: [{ text: `${systemPrompt}\n\n---\n\n${prompt}` }] }],
    });
    text = json.candidates?.[0]?.content?.parts?.[0]?.text || "";
  } else {
    fail(`Unsupported provider: ${provider}`);
  }

  log("─────────────────────────────────────────────────────────");
  log(text);
  writeText(logRel, [
    "======================================================",
    "Harness Agent Log",
    `Timestamp : ${currentTimestamp()}`,
    `Provider  : ${provider}`,
    `Model     : ${model}`,
    `Task-Type : ${type}`,
    `Role      : ${role}`,
    `Task      : ${prompt}`,
    "======================================================",
    "",
    text,
  ].join("\n"));
  return text;
}

function usage() {
  log(`Harness CLI

Usage:
  node tools/harness-cli/index.js check
  node tools/harness-cli/index.js create-ticket <name> <type> --goal "..."
  node tools/harness-cli/index.js start-ticket <name>
  node tools/harness-cli/index.js verify [--offline] [--diagnose] [--auto-fix]
  node tools/harness-cli/index.js run-agent [--type type] [--role role] "prompt"
  node tools/harness-cli/index.js complete-task <name> [--force]
  node tools/harness-cli/index.js scan-drift
  node tools/harness-cli/index.js autonomy [--status] [--verify-current] [--approve-risk] [--iterations N]
  node tools/harness-cli/index.js validate-auto-fix <patch-file>
  node tools/harness-cli/index.js validate-l5-patch <patch-file>
  node tools/harness-cli/index.js validate-prompts
  node tools/harness-cli/index.js validate-api-retry
`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "check":
    case "check-environment":
      await commandCheck(args);
      break;
    case "create-ticket":
      commandCreateTicket(args);
      break;
    case "start-ticket":
      commandStartTicket(args);
      break;
    case "complete-task":
      commandCompleteTask(args);
      break;
    case "verify":
      await commandVerify(args);
      break;
    case "run-agent":
      await commandRunAgent(args);
      break;
    case "scan-drift":
      commandScanDrift(args);
      break;
    case "autonomy":
      await commandAutonomy(args);
      break;
    case "validate-auto-fix":
      commandValidateAutoFix(args);
      break;
    case "validate-l5-patch":
      commandValidateL5Patch(args);
      break;
    case "validate-prompts":
      commandValidatePrompts();
      break;
    case "validate-api-retry":
      await commandValidateApiRetry();
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      usage();
      break;
    default:
      usage();
      fail(`Unknown command: ${command}`);
  }
}

main().catch((error) => {
  process.stderr.write(`[FAIL] ${error.message}\n`);
  process.exit(Number.isInteger(error.code) ? error.code : 1);
});
