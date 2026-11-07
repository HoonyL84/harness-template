"use strict";

function createSingleRepoTaskCommands({
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
}) {
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

  function commandCreateTicket(args) {
    const { positional, options } = parseArgs(args);
    const [name, type] = positional;
    if (!name || !type) fail("Usage: node tools/harness-cli/index.js create-ticket <name> <type> --goal \"...\"");
    if (!VALID_TYPES.has(type)) fail(`ticket type must be one of ${Array.from(VALID_TYPES).join(", ")}`);
    if (!options.goal) fail("--goal is required");

    const ticketRel = `.harness/tasks/backlog/${name}.md`;
    if (exists(ticketRel)) fail(`Ticket already exists: ${ticketRel}`);
    if (exists(`.harness/tasks/active/${name}.md`)) fail(`Active ticket already exists: .harness/tasks/active/${name}.md`);
    if (exists(`.harness/tasks/review/${name}.md`)) fail(`Review ticket already exists: .harness/tasks/review/${name}.md; resume with start-ticket --from-review`);

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
    if (!name) fail("Usage: node tools/harness-cli/index.js start-ticket <name> [--from-review] [--allow-parallel]");

    const backlogRel = `.harness/tasks/${options["from-review"] ? "review" : "backlog"}/${name}.md`;
    const activeRel = `.harness/tasks/active/${name}.md`;
    const existingActive = listTaskNames("active");

    if (!exists(backlogRel)) fail(`Source ticket not found: ${backlogRel}`);
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
    if (!options.force) {
      try {
        requireTaskOrchestrationReady(ROOT, name);
      } catch (error) {
        fail(error.message);
      }
    }

    const verifyRel = `observability/metrics/${name}.verify.json`;
    const startRel = `observability/metrics/${name}.start.json`;
    const doneRel = `observability/metrics/${name}.done.json`;
    const activeRel = `.harness/tasks/active/${name}.md`;
    const archiveRel = `.harness/tasks/archive/${name}.md`;

    let verify = { result: "none", rework_count: 0, last_fail_reason: "none" };
    if (exists(verifyRel)) {
      verify = { ...verify, ...JSON.parse(readText(verifyRel)) };
    }

    const fullVerify = getFullVerifyRecord(verify);
    if (!options.force && fullVerify.result !== "pass") {
      fail("Task verification is not marked as pass in full mode. Re-run full verification or use --force.");
    }
    if (!options.force) {
      requireCurrentVerifiedContent(name, fullVerify);
    }

    let start = { started_at: "unknown", type: "unknown", project: "unknown" };
    if (exists(startRel)) {
      start = { ...start, ...JSON.parse(readText(startRel)) };
    }

    let branchName = "";
    if (start.type && start.type !== "unknown") {
      branchName = `${start.type}/${name}`;
    } else {
      const gitList = run("git", ["branch", "--list", `*/${name}`, `*${name}`], { capture: true });
      if (gitList.status === 0 && gitList.stdout.trim()) {
        branchName = gitList.stdout.replace(/\*/g, "").trim().split(/\s+/)[0];
      }
    }

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

    appendHistory(ROOT, {
      project_id: "harness",
      ticket_id: name,
      kind: "COMPLETION_EVIDENCE",
      status: options.force ? "FORCED" : "VERIFIED",
      timestamp: fullVerify.verified_at || start.started_at,
      start,
      verification: fullVerify,
      forced: Boolean(options.force)
    });

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
      appendTaskCompletion(archiveRel, { ...verify, ...fullVerify });
      log("[Harness] EXEC_PLAN archived");
    } else {
      log(`[Harness] EXEC_PLAN not found: ${activeRel}`);
    }

    writeText(doneRel, JSON.stringify({
      task: name,
      type: start.type || "unknown",
      project: start.project || "unknown",
      started_at: start.started_at || "unknown",
      completed_at: currentTimestamp(),
      rework_count: verify.rework_count || 0,
      last_fail_reason: verify.last_fail_reason || "none",
      verify_result: fullVerify.result || "none",
    }, null, 2));

    removeIfExists(startRel);
    removeIfExists(verifyRel);

    log(`[Harness] Done metric written: ${doneRel}`);
    log("[Harness] Task complete.");
    log(`[Harness] Next: ${gitPublishAction()} the archived ticket and completion metadata.`);
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
      if (exists(`.harness/tasks/backlog/${name}.md`) || exists(`.harness/tasks/active/${name}.md`) || exists(`.harness/tasks/archive/${name}.md`) || exists(`.harness/tasks/review/${name}.md`)) {
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

  return {
    commandCreateTicket,
    commandStartTicket,
    commandCompleteTask,
    createPlannedTickets,
    ensureCurrentTicket
  };
}

module.exports = { createSingleRepoTaskCommands };
