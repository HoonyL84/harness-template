"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const crypto = require("crypto");
const { matchesPattern } = require("./verify-utils");
const {
  createOrchestrationState,
  createRunId,
  detectCapabilities,
  nextRecoveryAction,
  normalizeArtifact,
  normalizePath,
  readState,
  selectMode,
  stateFingerprint,
  validateWorkerPlan,
  writeJsonAtomic
} = require("./orchestration-utils");

function parseArgs(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (!value.startsWith("--")) {
      positional.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = args[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
    } else {
      options[key] = true;
    }
  }
  return { positional, options };
}

function runGit(root, args, { cwd = root, allowFailure = false } = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (!allowFailure && (result.error || result.status !== 0)) {
    const detail = result.error?.message || result.stderr || result.stdout || "unknown git failure";
    throw new Error(`git ${args.join(" ")} failed: ${detail.trim()}`);
  }
  return result;
}

function stateDir(root, runId) {
  if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(String(runId || ""))) {
    throw new Error("Orchestration run id is invalid.");
  }
  return path.join(root, "observability", "orchestration", runId);
}

function statePath(root, runId) {
  return path.join(stateDir(root, runId), "state.json");
}

function readRunState(root, runId) {
  const filePath = statePath(root, runId);
  if (!fs.existsSync(filePath)) throw new Error(`Orchestration run not found: ${runId}`);
  return readState(filePath);
}

function resolveRepositoryFile(root, value, label) {
  const resolved = path.resolve(root, String(value || ""));
  const normalizedRoot = path.resolve(root);
  if (resolved !== normalizedRoot && !resolved.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`${label} must stay inside the repository.`);
  }
  return resolved;
}

function saveRunState(root, state, patch = {}) {
  const next = { ...state, ...patch, updated_at: new Date().toISOString() };
  next.state_fingerprint = stateFingerprint({ ...next, state_fingerprint: undefined });
  writeJsonAtomic(statePath(root, state.run_id), next);
  return next;
}

function listTaskRuns(root, task) {
  const baseDir = path.join(root, "observability", "orchestration");
  if (!fs.existsSync(baseDir)) return [];
  return fs.readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        return readRunState(root, entry.name);
      } catch {
        return null;
      }
    })
    .filter((state) => state?.task === task);
}

function requireTaskOrchestrationReady(root, task) {
  const runs = listTaskRuns(root, task);
  if (runs.length === 0) return;
  const unfinished = runs.filter((state) => state.status !== "ready_to_complete");
  if (unfinished.length > 0) {
    throw new Error(
      `Task has unfinished orchestration runs: ${unfinished.map((state) => state.run_id).join(", ")}`
    );
  }
}

function writeRoleRequest(root, state, role, sequence) {
  const relativeArtifact = `artifacts/${role}-${sequence}.json`;
  const request = {
    schema_version: "1.0",
    run_id: state.run_id,
    task: state.task,
    role,
    output_artifact: relativeArtifact,
    instructions: [
      `Act as the ${role} for active ticket ${state.task}.`,
      "Read AGENTS.md and the active ticket before responding.",
      "Do not modify repository files.",
      "Return one JSON object matching the orchestration artifact contract.",
      "Set approval_required=true when the proposal crosses a documented approval boundary."
    ]
  };
  const requestPath = path.join(stateDir(root, state.run_id), "requests", `${role}-${sequence}.json`);
  writeJsonAtomic(requestPath, request);
  return {
    id: `${role}-${sequence}`,
    role,
    status: "pending",
    request: path.relative(root, requestPath).replace(/\\/g, "/"),
    artifact: `observability/orchestration/${state.run_id}/${relativeArtifact}`
  };
}

function artifactPrompt(root, state, role) {
  const ticketPath = path.join(root, ".harness", "tasks", "active", `${state.task}.md`);
  const ticket = fs.readFileSync(ticketPath, "utf8");
  return [
    `Act as the ${role} for this Harness task.`,
    "Return JSON only with keys:",
    "role, status, summary, assumptions, findings, proposed_actions, owned_paths, approval_required.",
    "Do not modify files. Identify approval boundaries explicitly.",
    "",
    ticket
  ].join("\n");
}

function recordArtifact(root, state, role, artifactInput) {
  const artifact = normalizeArtifact(artifactInput, role);
  const artifactRel = `observability/orchestration/${state.run_id}/artifacts/${role}.json`;
  writeJsonAtomic(path.join(root, artifactRel), artifact);
  const roles = state.roles.filter((entry) => entry.role !== role);
  roles.push({
    id: `${role}-1`,
    role,
    status: artifact.status,
    artifact: artifactRel
  });
  const approvalRequired = new Set(state.approval_required || []);
  if (artifact.approval_required || artifact.status === "approval_required") {
    approvalRequired.add(role);
  }
  const requiredPlanningRoles = ["planner", "architect"];
  const requiredReviewRoles = ["reviewer", "verifier"];
  const completed = new Set(roles.filter((entry) => entry.status === "completed").map((entry) => entry.role));
  const reviewArtifacts = roles
    .filter((entry) => requiredReviewRoles.includes(entry.role) && entry.status === "completed")
    .map((entry) => JSON.parse(fs.readFileSync(path.join(root, entry.artifact), "utf8")));
  const unresolvedReview = reviewArtifacts.some((artifact) =>
    artifact.approval_required || artifact.findings.length > 0);
  let phase = state.phase;
  let status = state.status;
  if (approvalRequired.size > 0) {
    status = "approval_required";
  } else if (requiredPlanningRoles.every((requiredRole) => completed.has(requiredRole))
      && ["planning", "awaiting_host"].includes(state.phase)) {
    phase = "implementation";
    status = "awaiting_implementation";
  } else if (requiredReviewRoles.every((requiredRole) => completed.has(requiredRole))
      && state.phase === "review") {
    if (unresolvedReview) {
      phase = "review";
      status = "review_blocked";
    } else if (state.integration) {
      phase = "review";
      status = "review_passed";
    } else {
      phase = "verification";
      status = "full_verify_required";
    }
  }
  return saveRunState(root, state, {
    roles,
    phase,
    status,
    approval_required: Array.from(approvalRequired)
  });
}

function printCapabilities(log, detected, configured) {
  log("Harness orchestration capabilities");
  log(`  enabled            : ${configured.enabled}`);
  log(`  adapter            : ${detected.adapter}`);
  log(`  parallel           : ${detected.capabilities.parallel}`);
  log(`  delegation         : ${detected.capabilities.delegation}`);
  log(`  workspace_write    : ${detected.capabilities.workspaceWrite}`);
  log(`  interactive_approval: ${detected.capabilities.interactiveApproval}`);
  log(`  fallback           : ${detected.fallback}`);
}

function validateActiveTask(root, task) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(task)) {
    throw new Error("Orchestration task must be a kebab-case ticket name.");
  }
  const ticketPath = path.join(root, ".harness", "tasks", "active", `${task}.md`);
  if (!fs.existsSync(ticketPath)) throw new Error(`Active ticket not found: ${task}`);
}

function dirtyPaths(root) {
  const result = runGit(root, ["status", "--porcelain=v1", "-z"]);
  return result.stdout.split("\0").filter(Boolean).map((entry) => normalizePath(entry.slice(3)));
}

function validateStartWorktree(root, task) {
  const allowed = new Set([`.harness/tasks/active/${task}.md`]);
  const unexpected = dirtyPaths(root).filter((file) => !allowed.has(file));
  if (unexpected.length > 0) {
    throw new Error(
      `Orchestration requires a clean implementation baseline. Commit or stash: ${unexpected.slice(0, 10).join(", ")}`
    );
  }
  const branch = runGit(root, ["branch", "--show-current"]).stdout.trim();
  if (!branch || ["main", "master"].includes(branch)) {
    throw new Error("Orchestration must run on a non-main task branch.");
  }
  return {
    branch,
    baseCommit: runGit(root, ["rev-parse", "HEAD"]).stdout.trim()
  };
}

function prepareWorkers(root, state, planFile, config) {
  if (!config.allowMultiWriter) {
    throw new Error("Multi-writer orchestration is disabled. Enable multi_agent.allow_multi_writer explicitly.");
  }
  const rawPlan = JSON.parse(fs.readFileSync(path.resolve(root, planFile), "utf8"));
  const plan = validateWorkerPlan(rawPlan, {
    maxWorkers: config.maxWorkers,
    allowMultiWriter: config.allowMultiWriter
  });
  if (plan.approval_required.length > 0) {
    return saveRunState(root, state, {
      status: "approval_required",
      approval_required: plan.approval_required.map((id) => `high-risk-path:${id}`)
    });
  }

  let nextState = saveRunState(root, state, {
    phase: "workers",
    status: "preparing_workers",
    workers: [],
    integration_order: plan.integration_order
  });
  for (const worker of plan.workers) {
    const branch = `orchestrate/${state.run_id}/${worker.id}`;
    const worktreeRel = `.worktrees/orchestrate/${state.run_id}/${worker.id}`;
    const worktree = path.join(root, worktreeRel);
    if (fs.existsSync(worktree)) throw new Error(`Worker worktree already exists: ${worktreeRel}`);
    const branchCheck = runGit(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
      allowFailure: true
    });
    if (branchCheck.status === 0) throw new Error(`Worker branch already exists: ${branch}`);
    fs.mkdirSync(path.dirname(worktree), { recursive: true });
    runGit(root, ["worktree", "add", "-b", branch, worktree, state.base_commit]);
    const prepared = {
      ...worker,
      branch,
      worktree: worktreeRel.replace(/\\/g, "/"),
      status: "ready",
      base_commit: state.base_commit,
      commit_sha: null,
      diff_hash: null,
      verify_result: null
    };
    nextState = saveRunState(root, nextState, {
      workers: [...nextState.workers, prepared]
    });
  }
  return saveRunState(root, nextState, {
    status: "workers_ready",
  });
}

function commitChangedPaths(root, baseCommit, commitSha) {
  const result = runGit(root, ["diff", "--name-only", `${baseCommit}..${commitSha}`]);
  return result.stdout.split(/\r?\n/).map(normalizePath).filter(Boolean);
}

function pathIsOwned(filePath, ownedPaths) {
  const normalized = normalizePath(filePath);
  return ownedPaths.some((ownedPath) => matchesPattern(normalized, normalizePath(ownedPath)));
}

function changedEntries(root, baseCommit, commitSha) {
  const result = runGit(root, ["diff", "--name-status", "-M", "-C", `${baseCommit}..${commitSha}`]);
  return result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [status, ...paths] = line.split("\t");
    return { status, paths: paths.map(normalizePath) };
  });
}

function assertSafeWorkerChanges(root, state, worker, commitSha) {
  const count = Number(runGit(root, ["rev-list", "--count", `${state.base_commit}..${commitSha}`]).stdout.trim());
  if (count !== 1) {
    throw new Error(`Worker ${worker.id} must produce exactly one commit.`);
  }
  const parent = runGit(root, ["rev-parse", `${commitSha}^`]).stdout.trim();
  if (parent !== state.base_commit) {
    throw new Error(`Worker ${worker.id} commit parent must equal orchestration base.`);
  }
  const entries = changedEntries(root, state.base_commit, commitSha);
  const unsafe = entries.find((entry) => /^[DRC]/.test(entry.status));
  if (unsafe) {
    throw new Error(`Worker ${worker.id} cannot delete, rename, or copy files automatically: ${unsafe.paths.join(", ")}`);
  }
  const changedPaths = entries.flatMap((entry) => entry.paths);
  const outOfScope = changedPaths.filter((file) => !pathIsOwned(file, worker.owned_paths));
  if (outOfScope.length > 0) {
    throw new Error(`Worker ${worker.id} changed paths outside ownership: ${outOfScope.join(", ")}`);
  }
  return changedPaths;
}

function recordWorker(root, state, workerId, commitSha, verifyResult) {
  const worker = state.workers.find((candidate) => candidate.id === workerId);
  if (!worker) throw new Error(`Unknown worker: ${workerId}`);
  if (verifyResult !== "pass") {
    throw new Error(`Worker ${workerId} must have verify_result=pass before recording.`);
  }
  const commitCheck = runGit(root, ["cat-file", "-e", `${commitSha}^{commit}`], { allowFailure: true });
  if (commitCheck.status !== 0) throw new Error(`Worker commit does not exist: ${commitSha}`);
  const ancestorCheck = runGit(root, ["merge-base", "--is-ancestor", state.base_commit, commitSha], {
    allowFailure: true
  });
  if (ancestorCheck.status !== 0) {
    throw new Error(`Worker commit is not based on orchestration base: ${commitSha}`);
  }
  const workerHead = runGit(root, ["rev-parse", worker.branch], { allowFailure: true });
  if (workerHead.status !== 0 || workerHead.stdout.trim() !== commitSha) {
    throw new Error(`Worker commit must match branch ${worker.branch}.`);
  }
  const changedPaths = assertSafeWorkerChanges(root, state, worker, commitSha);
  const diff = runGit(root, ["diff", "--binary", `${state.base_commit}..${commitSha}`]).stdout;
  const diffHash = crypto.createHash("sha256").update(diff).digest("hex");
  const workers = state.workers.map((candidate) => candidate.id === workerId
    ? {
        ...candidate,
        status: "completed",
        commit_sha: commitSha,
        diff_hash: diffHash,
        changed_paths: changedPaths,
        verify_result: verifyResult
      }
    : candidate);
  const allCompleted = workers.every((candidate) => candidate.status === "completed");
  return saveRunState(root, state, {
    workers,
    status: allCompleted ? "workers_completed" : "workers_running"
  });
}

function integrateWorkers(root, state) {
  if (!Array.isArray(state.workers) || state.workers.length === 0
      || state.workers.some((worker) =>
        worker.status !== "completed" || !worker.commit_sha
        || worker.verify_result !== "pass" || !worker.diff_hash)) {
    throw new Error("All workers must be completed before integration.");
  }
  for (const worker of state.workers) {
    const branchHead = runGit(root, ["rev-parse", worker.branch], { allowFailure: true });
    if (branchHead.status !== 0 || branchHead.stdout.trim() !== worker.commit_sha) {
      throw new Error(`Worker branch moved after verification: ${worker.id}`);
    }
    assertSafeWorkerChanges(root, state, worker, worker.commit_sha);
    const diff = runGit(root, ["diff", "--binary", `${state.base_commit}..${worker.commit_sha}`]).stdout;
    const currentHash = crypto.createHash("sha256").update(diff).digest("hex");
    if (currentHash !== worker.diff_hash) {
      throw new Error(`Worker diff hash changed before integration: ${worker.id}`);
    }
  }
  const integrationBranch = `orchestrate/${state.run_id}/integration`;
  const integrationRel = `.worktrees/orchestrate/${state.run_id}/integration`;
  const integrationPath = path.join(root, integrationRel);
  if (fs.existsSync(integrationPath)) throw new Error(`Integration worktree already exists: ${integrationRel}`);
  fs.mkdirSync(path.dirname(integrationPath), { recursive: true });
  runGit(root, ["worktree", "add", "-b", integrationBranch, integrationPath, state.base_commit]);

  try {
    const byId = new Map(state.workers.map((worker) => [worker.id, worker]));
    for (const workerId of state.integration_order || state.workers.map((worker) => worker.id)) {
      runGit(root, ["cherry-pick", byId.get(workerId).commit_sha], { cwd: integrationPath });
    }
  } catch (error) {
    runGit(root, ["cherry-pick", "--abort"], { cwd: integrationPath, allowFailure: true });
    return saveRunState(root, state, {
      phase: "integration",
      status: "integration_conflict",
      conflicts: [error.message],
      integration: {
        branch: integrationBranch,
        worktree: integrationRel.replace(/\\/g, "/"),
        head_commit: runGit(root, ["rev-parse", "HEAD"], { cwd: integrationPath }).stdout.trim()
      }
    });
  }

  return saveRunState(root, state, {
    phase: "review",
    status: "awaiting_review",
    integration: {
      branch: integrationBranch,
      worktree: integrationRel.replace(/\\/g, "/"),
      head_commit: runGit(root, ["rev-parse", "HEAD"], { cwd: integrationPath }).stdout.trim()
    }
  });
}

function cleanupRun(root, state) {
  if (!["ready_to_complete", "cancelled", "failed"].includes(state.status)) {
    throw new Error("Cleanup is allowed only for terminal orchestration runs.");
  }
  const worktrees = [
    ...(state.workers || []).map((worker) => ({ path: worker.worktree, branch: worker.branch })),
    state.integration ? { path: state.integration.worktree, branch: state.integration.branch } : null
  ].filter(Boolean);
  for (const item of worktrees) {
    const absolute = path.resolve(root, item.path);
    const allowedRoot = path.resolve(root, ".worktrees", "orchestrate", state.run_id);
    if (absolute !== allowedRoot && !absolute.startsWith(`${allowedRoot}${path.sep}`)) {
      throw new Error(`Refusing to clean worktree outside orchestration root: ${item.path}`);
    }
    if (fs.existsSync(absolute)) runGit(root, ["worktree", "remove", absolute]);
    runGit(root, ["branch", "-d", item.branch], { allowFailure: true });
  }
}

function printStatus(log, state) {
  log(`Run      : ${state.run_id}`);
  log(`Task     : ${state.task}`);
  log(`Mode     : ${state.mode}`);
  log(`Adapter  : ${state.adapter}`);
  log(`Phase    : ${state.phase}`);
  log(`Status   : ${state.status}`);
  log(`Base     : ${state.base_commit}`);
  if (state.approval_required?.length) {
    log(`Approval : ${state.approval_required.join(", ")}`);
  }
  for (const role of state.roles || []) log(`Role     : ${role.role}=${role.status}`);
  for (const worker of state.workers || []) log(`Worker   : ${worker.id}=${worker.status}`);
}

async function commandOrchestrate({
  root,
  args,
  config,
  env = process.env,
  log = (message) => process.stdout.write(`${message}\n`),
  invokeAgent
}) {
  const { positional, options } = parseArgs(args);
  const requestedMaxWorkers = options["max-workers"] === undefined
    ? config.maxWorkers
    : Number(options["max-workers"]);
  if (!Number.isInteger(requestedMaxWorkers) || requestedMaxWorkers < 1 || requestedMaxWorkers > 8) {
    throw new Error("--max-workers must be an integer between 1 and 8.");
  }
  const effectiveConfig = { ...config, maxWorkers: requestedMaxWorkers };
  const detected = detectCapabilities({
    agentMode: env.HARNESS_AGENT_MODE || "interactive",
    adapter: config.adapter,
    env
  });
  if (options.capabilities) {
    printCapabilities(log, detected, effectiveConfig);
    return { action: "capabilities", detected };
  }

  const selectedRunId = options.status || options.resume || options.approve
    || options.record || options["prepare-workers"] || options["record-worker"]
    || options["begin-review"] || options.integrate || options.promote
    || options.finish || options.cleanup;
  if (selectedRunId) {
    let state = readRunState(root, selectedRunId);
    if (options.status) {
      printStatus(log, state);
      return state;
    }
    if (options.resume) {
      const action = nextRecoveryAction(state, {
        baseCommit: runGit(root, ["rev-parse", state.parent_branch], { allowFailure: true }).stdout.trim()
      });
      log(`Recovery action: ${action.action}`);
      log(`Reason         : ${action.reason}`);
      return action;
    }
    if (options.record) {
      if (!options.role || !options.artifact) {
        throw new Error("--record requires --role <role> and --artifact <path>.");
      }
      const artifactPath = resolveRepositoryFile(root, options.artifact, "Artifact path");
      const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
      state = recordArtifact(root, state, options.role, artifact);
      if (state.adapter === "sequential-local" && state.status !== "approval_required") {
        const nextRole = options.role === "planner"
          ? "architect"
          : options.role === "reviewer"
            ? "verifier"
            : null;
        if (nextRole) {
          const existing = state.roles.some((entry) => entry.role === nextRole);
          if (!existing) {
            state = saveRunState(root, state, {
              phase: options.role === "planner" ? "awaiting_host" : "review",
              status: "awaiting_host",
              roles: [...state.roles, writeRoleRequest(root, state, nextRole, state.roles.length + 1)]
            });
          }
        }
      }
      printStatus(log, state);
      return state;
    }
    if (options.approve) {
      const statusByPhase = {
        planning: "running",
        awaiting_host: "awaiting_host",
        implementation: "awaiting_implementation",
        workers: state.workers?.every((worker) => worker.status === "completed")
          ? "workers_completed"
          : "workers_ready",
        integration: "manual_review",
        review: "awaiting_review",
        verification: "full_verify_required"
      };
      state = saveRunState(root, state, {
        status: statusByPhase[state.phase] || "manual_review",
        approval_required: [],
        approved_at: new Date().toISOString()
      });
      printStatus(log, state);
      return state;
    }
    if (options["prepare-workers"]) {
      if (!options.plan) throw new Error("--prepare-workers requires --plan <file>.");
      const planPath = resolveRepositoryFile(root, options.plan, "Worker plan path");
      state = prepareWorkers(root, state, planPath, effectiveConfig);
      printStatus(log, state);
      return state;
    }
    if (options["begin-review"]) {
      if (!["implementation", "review"].includes(state.phase)) {
        throw new Error("Review can start only after implementation or worker execution.");
      }
      const currentBranch = runGit(root, ["branch", "--show-current"]).stdout.trim();
      if (state.phase === "implementation" && currentBranch !== state.parent_branch) {
        throw new Error(`Single-writer review must start from parent branch ${state.parent_branch}.`);
      }
      const reviewRoleNames = state.adapter === "sequential-local"
        ? ["reviewer"]
        : ["reviewer", "verifier"];
      const roles = reviewRoleNames.map((role, index) =>
        writeRoleRequest(root, state, role, index + 1));
      state = saveRunState(root, state, {
        phase: "review",
        status: "awaiting_host",
        roles: [...state.roles.filter((entry) => !["reviewer", "verifier"].includes(entry.role)), ...roles]
      });
      printStatus(log, state);
      return state;
    }
    if (options["record-worker"]) {
      if (!options.worker || !options.commit || !options["verify-result"]) {
        throw new Error(
          "--record-worker requires --worker <id>, --commit <sha>, and --verify-result pass."
        );
      }
      state = recordWorker(
        root,
        state,
        options.worker,
        options.commit,
        options["verify-result"]
      );
      printStatus(log, state);
      return state;
    }
    if (options.integrate) {
      if (!options["approve-risk"]) throw new Error("--integrate requires --approve-risk.");
      state = integrateWorkers(root, state);
      printStatus(log, state);
      return state;
    }
    if (options.promote) {
      if (!options["approve-risk"]) throw new Error("--promote requires --approve-risk.");
      if (state.phase !== "review" || state.status !== "review_passed" || !state.integration?.branch) {
        throw new Error("Integration must be ready for review before promotion.");
      }
      const reviewRoles = new Map((state.roles || []).map((entry) => [entry.role, entry]));
      for (const role of ["reviewer", "verifier"]) {
        if (reviewRoles.get(role)?.status !== "completed") {
          throw new Error(`${role} must complete before promotion.`);
        }
        const artifactPath = resolveRepositoryFile(root, reviewRoles.get(role).artifact, `${role} artifact`);
        const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
        if (artifact.approval_required || artifact.findings?.length > 0) {
          throw new Error(`${role} findings must be resolved before promotion.`);
        }
      }
      const currentBranch = runGit(root, ["branch", "--show-current"]).stdout.trim();
      if (currentBranch !== state.parent_branch) {
        throw new Error(`Promotion must run from parent branch ${state.parent_branch}.`);
      }
      const unexpected = dirtyPaths(root)
        .filter((file) => file !== `.harness/tasks/active/${state.task}.md`);
      if (unexpected.length > 0) {
        throw new Error(`Promotion requires a clean parent worktree: ${unexpected.join(", ")}`);
      }
      runGit(root, ["merge", "--ff-only", state.integration.branch]);
      state = saveRunState(root, state, {
        phase: "verification",
        status: "full_verify_required",
        promoted_at: new Date().toISOString()
      });
      printStatus(log, state);
      return state;
    }
    if (options.finish) {
      if (state.phase !== "verification" || state.status !== "full_verify_required") {
        throw new Error("Orchestration can finish only after review passes and full verification is required.");
      }
      if ((state.approval_required || []).length > 0 || (state.conflicts || []).length > 0) {
        throw new Error("Orchestration has unresolved approvals or conflicts.");
      }
      if (typeof config.isFullVerifyCurrent !== "function" || !config.isFullVerifyCurrent(state.task)) {
        throw new Error("A current verify --full result is required before finishing orchestration.");
      }
      state = saveRunState(root, state, {
        phase: "completed",
        status: "ready_to_complete",
        completed_at: new Date().toISOString()
      });
      printStatus(log, state);
      return state;
    }
    if (options.cleanup) {
      if (!options["approve-risk"]) throw new Error("--cleanup requires --approve-risk.");
      cleanupRun(root, state);
      log(`Cleaned orchestration worktrees for ${selectedRunId}.`);
      return { action: "cleaned", runId: selectedRunId };
    }
  }

  const task = positional[0];
  if (!task) throw new Error("Usage: orchestrate <active-ticket> [--mode auto|native|api|sequential]");
  if (!effectiveConfig.enabled) {
    throw new Error("Multi-agent orchestration is disabled. Set multi_agent.enabled=true to opt in.");
  }
  validateActiveTask(root, task);
  const baseline = validateStartWorktree(root, task);
  const mode = selectMode(options.mode || config.defaultMode, detected);
  const runId = createRunId(task);
  let state = createOrchestrationState({
    runId,
    task,
    mode,
    adapter: detected.adapter,
    baseCommit: baseline.baseCommit,
    parentBranch: baseline.branch
  });
  saveRunState(root, state);

  const roles = ["planner", "architect"];
  if (detected.adapter === "provider-api" && typeof invokeAgent === "function") {
    const invoke = (role) => invokeAgent(role, artifactPrompt(root, state, role))
      .then((result) => ({ role, result }));
    let results;
    if (mode === "parallel") {
      const settled = await Promise.allSettled(roles.map(invoke));
      results = settled.map((item, index) => item.status === "fulfilled"
        ? item.value
        : {
            role: roles[index],
            result: {
              role: roles[index],
              status: "failed",
              summary: item.reason?.message || "provider call failed"
            }
          });
    } else {
      results = await roles.reduce(async (promise, role) => {
        const accumulated = await promise;
        accumulated.push(await invoke(role));
        return accumulated;
      }, Promise.resolve([]));
    }
    for (const { role, result } of results) {
      state = recordArtifact(root, state, role, result);
    }
    if (results.some(({ result }) => result.status === "failed")) {
      state = saveRunState(root, state, { status: "partial_failure" });
    }
  } else {
    const requestedRoles = detected.adapter === "sequential-local" ? ["planner"] : roles;
    const roleEntries = requestedRoles.map((role, index) =>
      writeRoleRequest(root, state, role, index + 1));
    state = saveRunState(root, state, {
      phase: "awaiting_host",
      status: "awaiting_host",
      roles: roleEntries
    });
  }

  printStatus(log, state);
  if (state.phase === "awaiting_host") {
    log("Next: the interactive host should execute pending role requests and record each artifact.");
  }
  return state;
}

module.exports = {
  commandOrchestrate,
  dirtyPaths,
  integrateWorkers,
  listTaskRuns,
  parseArgs,
  prepareWorkers,
  readRunState,
  recordArtifact,
  recordWorker,
  requireTaskOrchestrationReady,
  saveRunState
};
