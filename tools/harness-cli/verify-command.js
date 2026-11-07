"use strict";

function createVerifyCommands({
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
  validateAutoFixPatch,
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
}) {
  function packageScripts() {
    if (!exists("package.json")) return {};
    return JSON.parse(readText("package.json")).scripts || {};
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
      untrackedPaths,
    };
  }

  function describeWorktreeDrift(before, after) {
    const beforePaths = new Set(before.paths);
    const newPaths = after.paths.filter((rel) => !beforePaths.has(rel));
    return newPaths.length > 0
      ? `verification changed the worktree: ${newPaths.slice(0, 10).join(", ")}`
      : "verification changed files that were already dirty";
  }

  function requireCurrentVerifiedContent(name, verify) {
    if (!reportMemoryFormat()) fail("Memory format validation failed; re-run Full verification before completion.");
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

  function getFullVerifyRecord(verify) {
    if (isPlainObject(verify?.last_full)) return verify.last_full;
    if (verify?.mode === "full") {
      return {
        result: verify.result,
        verified_at: verify.last_verify,
        content_fingerprint: verify.content_fingerprint,
        reason: verify.last_fail_reason
      };
    }
    return { result: "none" };
  }

  function recordVerify(result, reason, contentFingerprint, verifyMode = "full") {
    const task = resolveTaskId();
    const rel = `observability/metrics/${task}.verify.json`;
    let reworkCount = 0;
    let lastFailReason = "";
    let previousRecord = {};
    if (exists(rel)) {
      try {
        previousRecord = JSON.parse(readText(rel));
        reworkCount = previousRecord.rework_count || 0;
        lastFailReason = previousRecord.last_fail_reason || "";
      } catch {
        reworkCount = 0;
        lastFailReason = "";
      }
    }
    if (result === "fail") reworkCount += 1;
    if (reason) lastFailReason = reason;

    const currentResult = {
      result,
      verified_at: currentTimestamp(),
      ...(reason ? { reason } : {}),
      ...(result === "pass" && contentFingerprint ? {
        content_fingerprint: contentFingerprint,
        verified_commit: run("git", ["rev-parse", "HEAD"], { capture: true }).stdout.trim()
      } : {})
    };
    const nextRecord = {
      ...previousRecord,
      task,
      last_verify: currentResult.verified_at,
      result,
      rework_count: reworkCount,
      mode: verifyMode
    };

    if (lastFailReason) nextRecord.last_fail_reason = lastFailReason;
    if (verifyMode === "full") nextRecord.last_full = currentResult;
    else nextRecord.last_quick = currentResult;
    delete nextRecord.content_fingerprint;

    writeText(rel, JSON.stringify(nextRecord, null, 2));
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

  function getDirtyFiles() {
    const status = run("git", ["status", "--porcelain", "-uall"], { capture: true });
    if (status.status !== 0 || status.error) return [];
    return status.stdout.split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .map(line => {
        const match = line.match(/^(?:[MADRCU?!\s]+)\s+(.+)$/);
        if (!match) return "";
        let p = match[1];
        if (p.includes(" -> ")) {
          p = p.split(" -> ").pop();
        }
        return p.replace(/^["']|["']$/g, "").replace(/\\/g, "/");
      })
      .filter(Boolean);
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

  async function commandVerify(args) {
    parseEnvFile();
    const { options } = parseArgs(args);
    applyExplicitTaskOption(options);
    resolveTaskId({ strict: true });
    const diagnose = options.diagnose || process.env.HARNESS_DIAGNOSE === "true";
    const autoFix = options["auto-fix"] || process.env.HARNESS_AUTO_FIX === "true";
    const offline = options.offline || process.env.HARNESS_OFFLINE === "1" || process.env.HARNESS_OFFLINE === "true";
    if (options.quick && options.full) fail("Choose either --quick or --full, not both.");
    const mode = options.quick ? "quick" : "full";
    const cfg = loadConfig();

    const maxAttempts = autoFix ? cfg.verify.maxAttempts : 1;
    let attempt = 0;
    let verifyPassed = false;
    let appliedPatchRel = "";
    let quickCacheRecord = null;
    const failedRepairHashes = new Set();
    let appliedRepairEvidence = null;

    ensureDir("observability/traces");
    ensureDir("observability/metrics");
    const logRel = `observability/traces/${fileTimestamp()}-verify.log`;
    const lines = [];
    const say = (message) => {
      lines.push(message);
      log(message);
    };

    const memoryGate = () => {
      if (mode !== "full" || reportMemoryFormat(say)) return;
      recordVerify("fail", "memory-format-invalid", null, "full");
      writeText(logRel, lines.join("\n"));
      fail("Memory format validation failed. Run memory check; no Full success fingerprint issued.");
    };
    memoryGate();

    while (attempt < maxAttempts && !verifyPassed) {
      const worktreeBefore = worktreeSnapshot();
      say(`[Harness] Verify execution started (Attempt ${attempt + 1}/${maxAttempts}, Mode: ${mode})`);
      if (offline) say("[OFFLINE] AI review skipped");

      let failedStep = null;
      const runStep = (label, command, stepArgs) => {
        say(`[${label}] ${command} ${stepArgs.join(" ")}`);
        const result = run(command, stepArgs, { capture: true });
        if (result.status !== 0) {
          failedStep = { label, command, stepArgs, status: result.status, stdout: result.stdout, stderr: result.stderr };
          return false;
        }
        return true;
      };

      const runStepAsync = async (label, command, stepArgs) => {
        say(`[${label}] ${command} ${stepArgs.join(" ")}`);
        const result = await runAsync(command, stepArgs, { capture: true });
        return {
          ok: result.status === 0,
          failure: {
            label,
            command,
            stepArgs,
            status: result.status,
            stdout: result.stdout,
            stderr: result.stderr
          }
        };
      };

      let success = true;
      let substantiveChecks = 0;

      if (mode === "quick") {
        const dirtyFiles = getDirtyFiles();
        say(`[Quick Verify] Dirty files: ${dirtyFiles.join(", ") || "none"}`);
        const quickMappings = cfg.verify.quick || {};
        const scripts = packageScripts();
        const rootFiles = fs.readdirSync(ROOT);
        const profiles = detectVerificationProfiles({ rootFiles, packageScripts: scripts });
        const inferredMappings = inferQuickMappings({
          packageScripts: scripts,
          profiles
        });
        const commandsToRun = selectQuickCommands(dirtyFiles, quickMappings, inferredMappings);
        if (Object.keys(quickMappings).length === 0 && Object.keys(inferredMappings).length > 0) {
          say("[Quick Verify] Using inferred project mappings.");
        }
        if (commandsToRun.length === 0) {
          say("[Quick Verify] No matching test commands found for dirty files. Inconclusive status.");
          recordVerify("inconclusive", "No matching test commands found for dirty files.", null, "quick");
          writeText(logRel, lines.join(os.EOL));
          process.exit(0);
        }
        const quickFingerprint = repositoryContentFingerprint();
        if (!quickFingerprint) fail("Quick verification cache key could not be calculated.");
        const quickCacheRel = `observability/metrics/${resolveTaskId()}.quick-cache.json`;
        const quickCacheKey = createQuickCacheKey({
          contentFingerprint: quickFingerprint,
          commands: commandsToRun,
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch
        });
        quickCacheRecord = {
          key: quickCacheKey,
          content_fingerprint: quickFingerprint,
          commands: commandsToRun,
          node_version: process.version,
          platform: process.platform,
          arch: process.arch
        };
        let cacheHit = false;
        if (cfg.verify.quickCache && exists(quickCacheRel)) {
          try {
            cacheHit = JSON.parse(readText(quickCacheRel)).key === quickCacheKey;
          } catch {
            say("[Quick Verify] Ignoring an unreadable cache record.");
          }
        }

        if (cacheHit) {
          say("[Quick Verify] Cache hit. Reusing checks for identical content, commands, and runtime.");
        } else {
          for (const fullCmdStr of commandsToRun) {
            say(`[Quick Verify] Executing: ${fullCmdStr}`);
            const profileStep = createQuickProfileStep(fullCmdStr, {
              platform: process.platform,
              hasMavenWrapper: exists("mvnw") || exists("mvnw.cmd")
            });
            if (profileStep) {
              success = runStep(`Quick ${profileStep.label}`, profileStep.command, profileStep.args);
              if (!success) break;
              continue;
            }
            const parts = tokenizeCommand(fullCmdStr);
            const cmd = parts[0];
            const cmdArgs = parts.slice(1);
            const resolvedCmd = (cmd === "npm" && process.platform === "win32") ? "npm.cmd" : cmd;
            success = runStep("Quick command", resolvedCmd, cmdArgs);
            if (!success) break;
          }
        }
      } else {
        const fullCmds = cfg.verify.full || [];
        if (Array.isArray(fullCmds) && fullCmds.length > 0) {
          for (const fullCmdStr of fullCmds) {
            const parts = tokenizeCommand(fullCmdStr);
            const cmd = parts[0];
            const cmdArgs = parts.slice(1);
            const resolvedCmd = (cmd === "npm" && process.platform === "win32") ? "npm.cmd" : cmd;
            success = runStep("Full command", resolvedCmd, cmdArgs);
            substantiveChecks += 1;
            if (!success) break;
          }
        } else {
          const scripts = packageScripts();
          const rootFiles = fs.readdirSync(ROOT);
          const profiles = detectVerificationProfiles({ rootFiles, packageScripts: scripts });
          if (profiles.length === 0) {
            recordVerify("fail", "unsupported-project", null, "full");
            fail("No supported project type detected. Configure verify.full explicitly.");
          }
          say(`[Full Verify] Detected profiles: ${profiles.join(", ")}`);
          const buildFiles = (exists("build.gradle") ? readText("build.gradle") : "")
            + "\n" + (exists("build.gradle.kts") ? readText("build.gradle.kts") : "");
          const steps = createProfileVerificationSteps({
            profiles,
            packageScripts: scripts,
            platform: process.platform,
            hasJacoco: buildFiles.includes("jacoco"),
            hasMavenWrapper: exists("mvnw") || exists("mvnw.cmd")
          });
          substantiveChecks += steps.filter((step) => step.substantive).length;
          const parallelSteps = steps.filter((step) =>
            step.script && cfg.verify.parallelScripts.has(step.script));
          const canRunParallel = parallelSteps.length > 1;
          if (canRunParallel) {
            say(`[Node] Running independent scripts in parallel: ${parallelSteps.map((step) => step.script).join(", ")}`);
            const results = await Promise.all(parallelSteps.map((step) =>
              runStepAsync(step.label, step.command, step.args)
            ));
            const failed = results.find((result) => !result.ok);
            if (failed) {
              success = false;
              failedStep = failed.failure;
            }
          }

          const sequentialSteps = canRunParallel
            ? steps.filter((step) => !step.script || !cfg.verify.parallelScripts.has(step.script))
            : steps;
          for (const step of sequentialSteps) {
            if (!success) break;
            success = runStep(step.label, step.command, step.args);
          }
        }
        if (success) {
          const scripts = packageScripts();
          const smokeCommands = cfg.verify.smoke.length ? cfg.verify.smoke
            : scripts["test:smoke"] ? ["npm run test:smoke"] : scripts.smoke ? ["npm run smoke"] : [];
          if (smokeCommands.length === 0) say("[Runtime Smoke] Not configured. Full test/build pass does not establish runtime behavior.");
          for (const commandLine of [...new Set(smokeCommands)]) {
            const [command, ...stepArgs] = tokenizeCommand(commandLine);
            const resolved = command === "npm" && process.platform === "win32" ? "npm.cmd" : command;
            success = runStep("Runtime Smoke", resolved, stepArgs);
            if (!success) break;
          }
        }
        if (success && substantiveChecks === 0) {
          recordVerify("inconclusive", "No test, coverage, build, or configured full verification command was available.", null, "full");
          fail("Full verification is inconclusive because no test, coverage, build, or configured full command ran.");
        }
      }

      if (worktreeBefore) {
        const worktreeAfter = worktreeSnapshot();
        recordCleanupCandidates(resolveTaskId(), worktreeBefore, worktreeAfter);
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
        memoryGate();
        verifyPassed = true;
        const contentFingerprint = repositoryContentFingerprint();
        if (!contentFingerprint) {
          recordVerify("fail", "repository-content-fingerprint-unavailable", null, mode);
          fail("Verification passed, but the repository content fingerprint could not be calculated.");
        }
        recordVerify("pass", "", contentFingerprint, mode);
        if (mode === "quick" && cfg.verify.quickCache && quickCacheRecord) {
          const quickCacheRel = `observability/metrics/${resolveTaskId()}.quick-cache.json`;
          writeText(quickCacheRel, JSON.stringify({
            ...quickCacheRecord,
            verified_at: currentTimestamp()
          }, null, 2));
        }
        if (appliedPatchRel) {
          say(`[Auto-fix] Verification passed. Patch retained for review: ${appliedPatchRel}`);
          await sendNotification("success", `✅ Low-risk auto-fix passed verification. Review patch: ${appliedPatchRel}`);
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

      let autoFixExhausted = false;
      let apiDiagnosisAttempted = false;
      let failedPatchRel = "";

      if (appliedPatchRel) {
        if (appliedRepairEvidence) failedRepairHashes.add(appliedRepairEvidence.patch_sha256);
        failedPatchRel = appliedPatchRel;
        try {
          applyGitPatch(appliedPatchRel, true);
          say(`[Auto-fix] Verification still failed. Applied patch was rolled back: ${appliedPatchRel}`);
        } catch (err) {
          say(`[Auto-fix] CRITICAL: Automatic rollback failed: ${err.message}`);
          recordVerify("fail", "rollback-failed; human inspection required", null, mode);
          writeText(logRel, lines.join(os.EOL));
          fail("Auto-fix rollback failed; stopping without another patch or destructive cleanup.");
        }
        appliedPatchRel = "";
        appliedRepairEvidence = null;
        autoFixExhausted = attempt + 1 >= maxAttempts;
      }

      if (autoFix && !autoFixExhausted) {
        const modeEnv = process.env.HARNESS_AGENT_MODE || "interactive";
        if (offline) {
          say("[Auto-fix] Disabled because offline mode is active.");
        } else if (modeEnv !== "api") {
          say("[Auto-fix] Requires HARNESS_AGENT_MODE=api. Falling back to diagnosis guidance.");
        } else if (attempt + 1 >= maxAttempts) {
          autoFixExhausted = true;
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
- ${REPAIR_CONTRACT}
- Change at most 5 files.
- Modify only existing low-risk source or test files in paths containing src/, app/, lib/, test/, tests/, or __tests__/.
- Do not modify configuration, dependencies, lockfiles, CI, scripts, infrastructure, database migrations, secrets, or documentation.
- Do not create, delete, or rename files.
- Avoid unrelated formatting or refactoring.`;

          try {
            say("[Auto-fix] Requesting one low-risk patch from the configured AI provider...");
            const response = await commandRunAgent(["--execution-mode", "auto-fix", "--type", "fix", "--role", "implementer", autoFixPrompt]);
            const patch = extractUnifiedDiff(response);
            appliedRepairEvidence = validateRepairResponse(response, patch, failedRepairHashes);
            const changedFiles = validateAutoFixPatch(patch);
            appliedPatchRel = `observability/traces/${fileTimestamp()}-auto-fix.patch`;
            writeText(`${appliedPatchRel}.repair.json`, JSON.stringify(appliedRepairEvidence, null, 2));
            writeText(appliedPatchRel, patch);
            applyGitPatch(appliedPatchRel);
            say(`[Auto-fix] Patch applied to: ${changedFiles.join(", ")}`);
            say("[Auto-fix] Re-running verification once.");
            attempt++;
            continue;
          } catch (err) {
            say(`[Auto-fix] Patch generation or application rejected: ${err.message}`);
            autoFixExhausted = true;
          }
        }
      }

      if (diagnose) {
        const modeEnv = process.env.HARNESS_AGENT_MODE || "interactive";
        if (modeEnv !== "api") {
          say("\n======================================================");
          say("🚨 [AGENT_COMMAND: SELF_DIAGNOSE_REQUIRED]");
          say("------------------------------------------------------");
          say("Verification step failed in interactive mode.");
          say(`Step: ${failedStep.label}`);
          say(`Command: ${failedStep.command} ${failedStep.stepArgs.join(" ")}`);
          say("\n[ERROR LOGS]");
          say(`Stderr:\n${failedStep.stderr.slice(-2000)}`);
          say(`Stdout:\n${failedStep.stdout.slice(-1000)}`);
          say("------------------------------------------------------");
          say("👉 INSTRUCTION FOR ACTIVE AGENT:");
          say("1. Analyze the verification failure details above.");
          say("2. Record observed evidence, a root-cause hypothesis, and one minimal distinguishing test before another repair.");
          say("3. Use codebase search / file write tools to fix the issue.");
          say("4. Once fixed, execute verification again using: npm run harness -- verify");
          say("======================================================\n");
        } else {
          apiDiagnosisAttempted = true;
          say(`[Diagnose] Step "${failedStep.label}" failed. Initiating self-diagnosis...`);

          const diagnosePrompt = `The verification step "${failedStep.label}" failed during task execution.
Command executed: ${failedStep.command} ${failedStep.stepArgs.join(" ")}

Stderr Output:
${failedStep.stderr.slice(-2500)}

Stdout Output:
${failedStep.stdout.slice(-1500)}

Please record observed evidence, one root-cause hypothesis, and a minimal test that distinguishes it. If a prior hypothesis failed, explain what evidence changes the next hypothesis. Do not recommend blindly rerunning an unchanged failing command. Then describe a minimal recovery within the approved scope.`;

          try {
            await commandRunAgent(["--type", "review", "--role", "reviewer", diagnosePrompt]);
            say("\n[Diagnose] Recovery guide generated in agent log above. Please follow the instructions to resolve the error.");
          } catch (err) {
            say(`[Diagnose] Self-diagnosis agent call failed: ${err.message}`);
          }
        }
      }

      recordVerify("fail", failureReason, null, mode);
      let blockedMsg = "";
      if (shouldBlockVerificationFailure({ autoFixExhausted, apiDiagnosisAttempted })) {
        const taskId = resolveTaskId();
        const reason = autoFixExhausted
          ? "Auto-fix attempts exhausted"
          : "API self-diagnosis completed; human intervention required";
        try {
          const blocked = blockActiveTask({ root: ROOT, taskId, failedStep, reason });
          if (blocked.moved) {
            blockedMsg = `\nTicket [${taskId}] moved to ${blocked.relativePath}. Human intervention required.`;
          }
        } catch (err) {
          say(`[Blocked] Ticket transition failed safely: ${err.message}`);
        }
      }

      writeText(logRel, lines.join(os.EOL));
      if (!offline) {
        const patchMsg = failedPatchRel ? `\nRolled back patch: ${failedPatchRel}` : "";
        await sendNotification("fail", `Verification step [${failedStep.label}] failed.${blockedMsg}${patchMsg}\nCommand: ${failedStep.command} ${failedStep.stepArgs.join(" ")}`);
      }
      process.exit(failedStep.status);
    }
  }

  return {
    verifyCurrentTicket,
    verifyCurrentTicketInProcess,
    dirtyPaths,
    worktreeSnapshot,
    describeWorktreeDrift,
    requireCurrentVerifiedContent,
    getFullVerifyRecord,
    recordVerify,
    summarizeVerifyFailure,
    getDirtyFiles,
    commandVerify
  };
}

module.exports = { createVerifyCommands };
