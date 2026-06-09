#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawnSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
process.chdir(ROOT);

const VALID_TYPES = new Set(["feat", "fix", "refactor", "docs", "chore", "experiment"]);
const VALID_ROLES = new Set(["planner", "architect", "implementer", "reviewer", "verifier", "recorder", "memory", "release"]);

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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: options.capture ? "pipe" : "inherit",
    encoding: "utf8",
    shell: false,
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
  const taskId = process.env.TASK_ID || "unknown";
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
    log(`[INFO] Current branch: ${getGitBranch()}`);
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
  if (activeCount > 1) warn(`Multiple active tickets detected: ${activeCount}. Prefer one active ticket when switching machines.`);
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
  const { positional } = parseArgs(args);
  const [name] = positional;
  if (!name) fail("Usage: node tools/harness-cli/index.js start-ticket <name>");

  const backlogRel = `.harness/tasks/backlog/${name}.md`;
  const activeRel = `.harness/tasks/active/${name}.md`;

  if (!exists(backlogRel)) fail(`Backlog ticket not found: ${backlogRel}`);
  if (exists(activeRel)) fail(`Active task already exists: ${activeRel}`);

  moveFile(backlogRel, activeRel);
  log(`Promoted ticket to active: ${activeRel}`);
  log("Next: implement, verify, commit, then archive with complete-task.");
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

function packageScripts() {
  if (!exists("package.json")) return {};
  return JSON.parse(readText("package.json")).scripts || {};
}

function recordVerify(result, reason) {
  const task = process.env.TASK_ID || getGitBranch().split("/").pop() || "local";
  const rel = `observability/metrics/${task}.verify.json`;
  let reworkCount = 0;
  if (exists(rel)) {
    try {
      const previous = JSON.parse(readText(rel));
      reworkCount = previous.rework_count || 0;
    } catch {
      reworkCount = 0;
    }
  }
  if (result === "fail") reworkCount += 1;
  writeText(rel, JSON.stringify({
    task,
    last_verify: currentTimestamp(),
    result,
    ...(reason ? { last_fail_reason: reason } : {}),
    rework_count: reworkCount,
  }, null, 2));
}

async function commandVerify(args) {
  parseEnvFile();
  const { options } = parseArgs(args);
  const diagnose = options.diagnose || process.env.HARNESS_DIAGNOSE === "true";
  const offline = options.offline || process.env.HARNESS_OFFLINE === "1" || process.env.HARNESS_OFFLINE === "true";
  const maxAttempts = 1; // For diagnosis, 1 attempt is sufficient to generate guide
  let attempt = 0;
  let verifyPassed = false;

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
    say(`[Harness] Verify execution started (Attempt ${attempt + 1}/${maxAttempts})`);
    if (offline) say("[OFFLINE] AI review skipped");

    let failedStep = null;
    const runStep = (label, command, stepArgs) => {
      say(`[${label}] ${command} ${stepArgs.join(" ")}`);
      // Run and capture outputs in case of failure for self-healing
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
        success = runStep("Node test", npmCommand, ["run", "test", "--", "--coverage"]);
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

    if (success) {
      verifyPassed = true;
      recordVerify("pass");
      say("All checks passed. Safe to commit.");
      writeText(logRel, lines.join(os.EOL));
      break;
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
        recordVerify("fail", failedStep.label);
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
      recordVerify("fail", failedStep.label);
      writeText(logRel, lines.join(os.EOL));
      await sendSlackNotification("fail", `❌ Verification step [${failedStep.label}] failed.\nCommand: ${failedStep.command} ${failedStep.stepArgs.join(" ")}\nSelf-diagnosis completed. Recovery guide generated.`);
      process.exit(failedStep.status);
    } else {
      // Verification failed and no diagnose/exhausted attempts
      recordVerify("fail", failedStep.label);
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
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) fail(`API request failed (${response.status}): ${JSON.stringify(json)}`);
  return json;
}

async function commandRunAgent(args) {
  parseEnvFile();
  const { positional, options } = parseArgs(args);
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
  const taskName = process.env.TASK_ID || getGitBranch().split("/").pop();
  const rolePrompt = readText(`prompts/system/roles/${role}.md`);
  const context = buildContextBundle(type, taskName);
  const systemPrompt = `당신은 하네스(Harness Engineering) 원칙을 따르는 시니어 소프트웨어 엔지니어입니다.
아래 규칙과 프로젝트 컨텍스트를 읽고 주어진 태스크를 수행하세요.

${context}

=== Agent Role (${role}) ===
${rolePrompt}

현재 태스크 유형: ${type}
현재 에이전트 역할: ${role}
규칙:
1. 코드 작성 시 AGENTS.md의 코딩 규칙을 엄격히 따르세요.
2. 불확실한 부분은 추측하지 말고 가정(Assumption)을 명시하세요.
3. 구현 완료 후 검증 방법을 함께 제시하세요.`;

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
}

function usage() {
  log(`Harness CLI

Usage:
  node tools/harness-cli/index.js check
  node tools/harness-cli/index.js create-ticket <name> <type> --goal "..."
  node tools/harness-cli/index.js start-ticket <name>
  node tools/harness-cli/index.js verify [--offline] [--diagnose]
  node tools/harness-cli/index.js run-agent [--type type] [--role role] "prompt"
  node tools/harness-cli/index.js complete-task <name> [--force]
  node tools/harness-cli/index.js scan-drift
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
  process.exit(error.code || 1);
});
