"use strict";

function createAutonomyRecoverCommands({
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
}) {
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

  function classifyL5Paths(paths) {
    const cfg = loadConfig().l5;
    const highRisk = [];
    for (const filePath of paths) {
      const normalized = path.posix.normalize(filePath);
      const segments = normalized.split("/").map((segment) => segment.toLowerCase());
      const fileName = segments[segments.length - 1];
      const resolved = path.resolve(ROOT, normalized);
      if (normalized.startsWith("../") || (!resolved.startsWith(`${ROOT}${path.sep}`) && resolved !== ROOT)) {
        fail(`L5 patch escapes the repository: ${filePath}`);
      }
      if (segments.some((segment) => cfg.protectedSegments.has(segment)) || fileName.startsWith(".env")) {
        fail(`L5 patch targets a protected harness or secret path: ${filePath}`);
      }
      if (segments.some((segment) => cfg.highRiskSegments.has(segment)) || cfg.highRiskFiles.has(fileName)) {
        highRisk.push(filePath);
      }
    }
    return [...new Set(highRisk)];
  }

  function validateL5Patch(patch) {
    patch = patch.replace(/^\uFEFF/, "");
    const cfg = loadConfig().limits;
    const maxBytes = cfg.maxPatchKb * 1000;
    const maxFiles = cfg.maxFiles;
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

    const cfg = loadConfig().auto_fix;
    for (const filePath of uniquePaths) {
      const normalized = path.posix.normalize(filePath);
      const segments = normalized.split("/");
      const fileName = segments[segments.length - 1].toLowerCase();
      const extension = path.posix.extname(fileName).toLowerCase();
      const resolved = path.resolve(ROOT, normalized);

      if (normalized.startsWith("../") || (!resolved.startsWith(`${ROOT}${path.sep}`) && resolved !== ROOT)) {
        fail(`Auto-fix patch escapes the repository: ${filePath}`);
      }
      if (!segments.some((segment) => cfg.allowedRoots.has(segment.toLowerCase()))) {
        fail(`Auto-fix path is outside low-risk source/test roots: ${filePath}`);
      }
      if (segments.some((segment) => cfg.forbiddenSegments.has(segment.toLowerCase()))) {
        fail(`Auto-fix path contains a protected segment: ${filePath}`);
      }
      if (cfg.forbiddenFiles.has(fileName) || fileName.startsWith(".env")) {
        fail(`Auto-fix cannot modify protected files: ${filePath}`);
      }
      if (!AUTO_FIX_ALLOWED_EXTENSIONS.has(extension)) {
        fail(`Auto-fix file type is not allowed: ${filePath}`);
      }
    }

    return uniquePaths;
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

  function assessRecovery({ state, active, dirty, headSha, verify, contentFingerprint, patchExists }) {
    if (active.length > 1) {
      return { action: "manual_review", reason: `multiple active tickets: ${active.join(", ")}` };
    }

    const ticket = state.current_ticket || active[0] || null;
    if (state.current_ticket && !active.includes(state.current_ticket)) {
      return { action: "manual_review", ticket, reason: "checkpoint ticket is not active" };
    }

    const checkpoint = state.recovery_checkpoint;
    if (checkpoint?.head_sha && checkpoint.head_sha !== headSha) {
      return { action: "manual_review", ticket, reason: "HEAD changed after the recovery checkpoint" };
    }

    const fullVerify = getFullVerifyRecord(verify);
    if (fullVerify.result === "pass") {
      if (fullVerify.content_fingerprint && fullVerify.content_fingerprint === contentFingerprint) {
        return {
          action: "ready_to_complete",
          ticket,
          reason: "current repository content matches the last successful verification",
        };
      }
      return {
        action: "reverify_required",
        ticket,
        reason: "repository content changed after the last successful verification",
      };
    }
    if (fullVerify.result === "fail") {
      return {
        action: "fix_and_reverify",
        ticket,
        reason: fullVerify.reason || "the last full verification failed",
      };
    }

    if (state.status === "approval_required") {
      return { action: "approval_required", ticket, reason: "a high-risk patch is waiting for explicit approval" };
    }

    if (["apply_failed", "rollback_failed"].includes(state.status)) {
      return { action: "manual_review", ticket, reason: `previous recovery-sensitive step ended as ${state.status}` };
    }

    if (state.status === "applying_patch" && checkpoint) {
      const before = [...(checkpoint.working_tree || [])].sort();
      const current = [...dirty].sort();
      if (JSON.stringify(before) === JSON.stringify(current) && patchExists) {
        return { action: "retry_patch", ticket, reason: "the checkpoint patch was not reflected in the worktree" };
      }
      return { action: "inspect_partial_patch", ticket, reason: "the worktree differs from the pre-apply checkpoint" };
    }

    const implementationDirty = dirty.filter((rel) => !normalizeRepoPath(rel).startsWith(".harness/tasks/"));
    if (implementationDirty.length > 0) {
      return {
        action: "inspect_and_verify",
        ticket,
        reason: "unverified implementation changes are present after interruption",
      };
    }

    if (state.status === "implementing") {
      return { action: "retry_agent", ticket, reason: "the provider call ended before producing worktree changes" };
    }
    if (ticket) {
      return { action: "resume_ticket", ticket, reason: "an active ticket is available without verified changes" };
    }
    return { action: "idle", ticket: null, reason: "no interrupted task was detected" };
  }

  function commandRecover() {
    const state = readAutonomyState();
    const active = listTaskNames("active");
    const dirty = dirtyPaths();
    if (dirty === null) fail("Recovery diagnostics require an executable git status command.");

    const ticket = state.current_ticket || (active.length === 1 ? active[0] : "");
    const verifyRel = ticket ? `observability/metrics/${ticket}.verify.json` : "";
    const verify = verifyRel && exists(verifyRel) ? JSON.parse(readText(verifyRel)) : {};
    const patchRel = state.pending_patch || state.recovery_checkpoint?.patch || "";
    const assessment = assessRecovery({
      state,
      active,
      dirty,
      headSha: gitHeadSha(),
      verify,
      contentFingerprint: repositoryContentFingerprint(),
      patchExists: Boolean(patchRel && exists(patchRel)),
    });

    log(JSON.stringify({
      ...assessment,
      state_status: state.status || "none",
      active,
      dirty_paths: dirty,
      verify_result: getFullVerifyRecord(verify).result || "none",
      last_fail_reason: verify.last_fail_reason || null,
      checkpoint: state.recovery_checkpoint || null,
      destructive_recovery_used: false,
    }, null, 2));
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

    const cfg = loadConfig().limits;
    const maxIterations = Number(options.iterations || cfg.maxIterations);
    const maxApiCalls = cfg.maxApiCalls;
    const maxMinutes = cfg.maxRuntimeMinutes;
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
        log("3. Run: npm run harness -- autonomy --verify-current");
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
    const startedAt = Date.now();
    let apiCalls = 0;
    const completed = 0;
    let ticket = ensureCurrentTicket();

    if (!ticket) {
      if (apiCalls >= maxApiCalls) fail("L5 API call budget exhausted before planning.");
      const planText = await commandRunAgent([
        "--execution-mode", "l5",
        "--type", "architect", "--role", "planner",
        renderPrompt("prompts/templates/l5-planner.md"),
      ]);
      apiCalls += 1;
      const created = createPlannedTickets(extractJson(planText));
      if (created.length === 0) fail("L5 planner created no new tickets.");
      ticket = ensureCurrentTicket();
    }

    if (ticket && completed < maxIterations && apiCalls < maxApiCalls) {
      if ((Date.now() - startedAt) / 60_000 >= maxMinutes) {
        writeAutonomyState({ status: "budget_exhausted", current_ticket: ticket, reason: "runtime" });
        return;
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
          "--execution-mode", "l5",
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

      writeAutonomyState({
        status: "awaiting_release_approval",
        current_ticket: ticket,
        verified_patch: patchRel,
        changed_files: patchInfo.paths,
        next_action: "Review the verified diff and explicitly approve any commit or push operation.",
      });
      log(`[L5 Experimental] ${ticket} passed verification and paused at the mandatory release approval gate.`);
      return;
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

  return {
    readAutonomyState,
    writeAutonomyState,
    validateL5Patch,
    classifyL5Paths,
    validateAutoFixPatch,
    assessRecovery,
    commandRecover,
    commandAutonomy
  };
}

module.exports = { createAutonomyRecoverCommands };
