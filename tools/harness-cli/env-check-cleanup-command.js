"use strict";

function createEnvCheckCleanupCommands({
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
}) {
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
      if (process.stdout.isTTY) {
        const readline = require("readline");
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

        const question = (query) => new Promise((resolve) => {
          rl.question(query, resolve);
        });

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
          log("");

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
    const provider = providerUsage.activeProvider();
    const config = loadConfig();
    const multiAgent = config.multiAgent;

    if (["interactive", "api"].includes(mode)) pass(`HARNESS_AGENT_MODE=${mode}`);
    else bad("HARNESS_AGENT_MODE must be interactive or api");
    if (multiAgent.enabled) warn(`HARNESS_MULTI_AGENT_ENABLED=true (${multiAgent.defaultMode}, opt-in)`);
    else pass("HARNESS_MULTI_AGENT_ENABLED=false (safe default)");
    pass(`HARNESS_AGENT_ADAPTER=${multiAgent.adapter}`);
    pass(`HARNESS_MULTI_AGENT_MAX_WORKERS=${multiAgent.maxWorkers}`);
    if (multiAgent.allowMultiWriter) warn("HARNESS_MULTI_AGENT_ALLOW_MULTI_WRITER=true (high coordination risk)");
    else pass("HARNESS_MULTI_AGENT_ALLOW_MULTI_WRITER=false (single writer)");
    pass(`HARNESS_VERIFY_MAX_ATTEMPTS=${config.verify.maxAttempts}`);

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
      if (process.env.HARNESS_AUTO_COMMIT === "true" || process.env.HARNESS_AUTO_PUSH === "true") {
        warn("HARNESS_AUTO_COMMIT/HARNESS_AUTO_PUSH are ignored; verified L5 work always stops at the release approval gate");
      }
      if (hasGitRemoteOrigin()) pass("Git remote origin configured");
      else warn("Git remote origin is not configured");

      const statusResult = run("git", ["status", "--porcelain"], { capture: true });
      if (statusResult.status !== 0 || statusResult.error) {
        const reason = statusResult.error?.message
          || statusResult.stderr.trim()
          || statusResult.stdout.trim()
          || `exit code ${statusResult.status}`;
        warn(`Git status could not be executed (${reason}). Check working tree before switching machines.`);
      } else if (statusResult.stdout.trim()) warn("Working tree has uncommitted changes. Commit or intentionally carry them before switching machines.");
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

    if (!reportMemoryFormat()) bad("Memory format violations: run memory check and follow docs/design-docs/memory-governance.md");

    log("----------------------------------------");
    log(`Environment preflight complete: fail=${failed} warn=${warned}`);
    process.exit(failed > 0 ? 1 : 0);
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

  function commandScanDrift() {
    const envTemplate = path.join(ROOT, ".env.template");
    if (!fs.existsSync(envTemplate)) {
      fail(".env.template not found. Cannot perform scan-drift.");
    }

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

    const files = findFilesInDir(ROOT, /\.(js|ts|java)$/);
    const codeVars = new Set();

    for (const file of files) {
      if (file.includes("node_modules") || file.includes(".worktrees")) continue;
      let content = fs.readFileSync(file, "utf8");
      content = content.replace(/\/\*[\s\S]*?\*\/|([^\\:]|^)\/\/.*$/gm, "$1");

      const jsRegex = /process\.env\.([A-Z_0-9]+)/g;
      let match;
      while ((match = jsRegex.exec(content)) !== null) {
        const v = match[1];
        if (!isRuntimeManagedEnv(v)) codeVars.add(v);
      }

      const javaRegex = /System\.getenv\(\s*"([A-Z_0-9]+)"\s*\)/g;
      while ((match = javaRegex.exec(content)) !== null) {
        const v = match[1];
        if (!isRuntimeManagedEnv(v)) codeVars.add(v);
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

  function sha256File(filePath) {
    return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
  }

  function normalizedAbsolutePath(filePath) {
    const resolved = path.resolve(filePath);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  }

  function isPathInsideRoot(filePath) {
    const root = normalizedAbsolutePath(ROOT);
    const resolved = normalizedAbsolutePath(filePath);
    return resolved.startsWith(`${root}${path.sep}`) && resolved !== root;
  }

  function cleanupCandidateRel(task) {
    return `observability/metrics/${task}.cleanup-candidates.json`;
  }

  function recordCleanupCandidates(task, before, after) {
    if (!before || !after) return;
    const generated = findGeneratedPaths(before.untrackedPaths, after.untrackedPaths);
    const files = [];

    for (const rel of generated) {
      const fullPath = path.resolve(ROOT, rel);
      if (!isPathInsideRoot(fullPath) || !fs.existsSync(fullPath)) continue;
      const stat = fs.lstatSync(fullPath);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      files.push({ path: normalizeRepoPath(rel), sha256: sha256File(fullPath) });
    }

    const rel = cleanupCandidateRel(task);
    if (files.length === 0) {
      removeIfExists(rel);
      return;
    }
    writeText(rel, JSON.stringify({
      task,
      captured_at: currentTimestamp(),
      files
    }, null, 2));
  }

  function commandCleanup(args) {
    const { options } = parseArgs(args);
    const manifestDir = path.join(ROOT, "observability", "metrics");
    ensureDir("observability/metrics");

    const runCheckIgnore = (filePath) => {
      const result = run("git", ["check-ignore", "--", filePath], { capture: true });
      return result.status === 0;
    };

    if (options["dry-run"] || (!options.approve && !options["dry-run"])) {
      const task = resolveTaskId({ strict: true });
      const candidateRel = cleanupCandidateRel(task);
      if (!exists(candidateRel)) {
        log("No verification-generated cleanup candidates found.");
        return;
      }

      const candidateRecord = JSON.parse(readText(candidateRel));
      const safeToDelete = [];
      for (const candidate of candidateRecord.files || []) {
        const file = normalizeRepoPath(candidate.path || "");
        const fullPath = path.resolve(ROOT, file);
        if (!isPathInsideRoot(fullPath) || !fs.existsSync(fullPath)) continue;
        const stat = fs.lstatSync(fullPath);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        if (runCheckIgnore(file)) {
          log(`[Cleanup Skip] Git ignored path: ${file}`);
          continue;
        }
        if (sha256File(fullPath) !== candidate.sha256) {
          log(`[Cleanup Skip] File changed after verification: ${file}`);
          continue;
        }
        safeToDelete.push({ path: file, sha256: candidate.sha256 });
      }

      if (safeToDelete.length === 0) {
        log("No verification-generated files are currently safe to clean.");
        return;
      }

      const manifest = createCleanupManifest(task, currentTimestamp(), safeToDelete);
      const manifestId = manifest.id;
      const manifestPath = path.join(manifestDir, `cleanup-${manifestId}.json`);
      writeText(path.relative(ROOT, manifestPath), JSON.stringify(manifest, null, 2));
      log(`Cleanup Dry-Run complete. Found ${safeToDelete.length} verification-generated files.`);
      log(`Manifest ID: ${manifestId}`);
      log(`To approve cleanup, run: node tools/harness-cli/index.js cleanup --approve ${manifestId}`);
      return;
    }

    const manifestId = String(options.approve).trim();
    if (!/^[a-f0-9]{12}$/i.test(manifestId)) fail("Cleanup manifest ID is invalid.");
    const manifestPath = path.join(manifestDir, `cleanup-${manifestId}.json`);
    const relManifestPath = path.relative(ROOT, manifestPath);
    if (!fs.existsSync(manifestPath)) fail(`Cleanup manifest not found or expired: ${manifestId}`);

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    } catch (err) {
      fail(`Failed to parse manifest: ${err.message}`);
    }
    if (manifest.id !== manifestId || !isCleanupManifestValid(manifest)) {
      removeIfExists(relManifestPath);
      fail(`Cleanup manifest ${manifestId} is invalid or was tampered with.`);
    }

    const createdAt = Date.parse(manifest.created_at);
    if (Number.isNaN(createdAt) || Date.now() - createdAt > 10 * 60 * 1000) {
      removeIfExists(relManifestPath);
      fail(`Cleanup manifest ${manifestId} has expired (TTL 10m). Please run dry-run again.`);
    }

    const dirsToClean = new Set();
    for (const candidate of manifest.files) {
      if (!isPlainObject(candidate) || typeof candidate.path !== "string" || typeof candidate.sha256 !== "string") {
        log("[Cleanup Bypass] Invalid manifest entry.");
        continue;
      }

      const normalized = path.posix.normalize(candidate.path);
      const fullPath = path.resolve(ROOT, normalized);
      if (!isPathInsideRoot(fullPath)) {
        log(`[Cleanup Bypass] Path escapes repository: ${candidate.path}`);
        continue;
      }
      if (!fs.existsSync(fullPath)) continue;

      const statusResult = run("git", ["status", "--porcelain", "--", normalized], { capture: true });
      if (statusResult.status !== 0 || !statusResult.stdout.trim().startsWith("??")) {
        log(`[Cleanup Bypass] File is no longer untracked: ${candidate.path}`);
        continue;
      }
      if (runCheckIgnore(normalized)) {
        log(`[Cleanup Bypass] File is git-ignored: ${candidate.path}`);
        continue;
      }

      const stat = fs.lstatSync(fullPath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        log(`[Cleanup Bypass] File type is not eligible: ${candidate.path}`);
        continue;
      }
      const realPath = fs.realpathSync(fullPath);
      if (!isPathInsideRoot(realPath) || sha256File(fullPath) !== candidate.sha256) {
        log(`[Cleanup Bypass] File changed or resolves outside repository: ${candidate.path}`);
        continue;
      }

      fs.unlinkSync(fullPath);
      log(`Removed file: ${candidate.path}`);
      let parent = path.dirname(fullPath);
      while (isPathInsideRoot(parent)) {
        dirsToClean.add(parent);
        parent = path.dirname(parent);
      }
    }

    for (const dir of Array.from(dirsToClean).sort((a, b) => b.length - a.length)) {
      if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
        fs.rmdirSync(dir);
        log(`Removed empty directory: ${path.relative(ROOT, dir)}`);
      }
    }

    removeIfExists(relManifestPath);
    if (manifest.task) removeIfExists(cleanupCandidateRel(manifest.task));
    log(`Cleanup approved and completed for manifest ${manifestId}.`);
  }

  return {
    commandCheck,
    commandScanDrift,
    commandCleanup,
    recordCleanupCandidates
  };
}

module.exports = { createEnvCheckCleanupCommands };
