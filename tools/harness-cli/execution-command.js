"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readJson, updateJsonLocked, withFileLock } = require("./control-plane-state");
const { readOnboardingProfile } = require("./project-onboarding");
const { assertExecutionMatchesPlan, assertProjectSnapshot, buildExecutionState, dependencyReadiness, finalizeExecutionState } = require("./project-execution");
const { inspectGitProject, readRegistry, validateProjectId } = require("./project-registry");
const { readPlan } = require("./request-command");
const { requireRequestReady } = require("./request-plan");
const { createVerificationOwner } = require("./verification-lease");
const { requireJiraFresh } = require("./jira-input");
const { buildProjectContextBundle } = require("./project-context");
const { isArtifactTicket, verifyArtifactTicket } = require("./ticket-artifacts");

function createExecutionCommand({ root, parseArgs, reviewFingerprint, runCommand, runGit, tokenizeCommand, log, env = process.env, fetchImpl = globalThis.fetch }) {
  const local = path.join(root, ".harness", "local");
  const statePath = (id) => path.join(local, "executions", `${validateProjectId(id)}.json`);
  const requireGitSuccess = (args, cwd) => {
    const result = runGit(args, cwd);
    if (result.error || result.status !== 0) throw new Error(String(result.stderr || result.error?.message || `git ${args.join(" ")} failed`).trim());
    return String(result.stdout || "").trim();
  };
  const loadExecutionInputs = (id, { fresh = true } = {}) => {
    const plan = readPlan(path.join(local, "requests", `${id}.json`), { fresh });
    const registry = readRegistry(path.join(local, "projects.json"));
    const projectIds = [...new Set(plan.tickets.map((ticket) => ticket.project_id))];
    const profiles = Object.fromEntries(projectIds.map((projectId) => [
      projectId,
      readOnboardingProfile(path.join(local, "profiles", `${projectId}.json`))
    ]));
    requireRequestReady(plan, profiles);
    return { plan, registry, profiles };
  };
  const prepareTicket = (ticket, state, registry, profiles) => {
    const readiness = dependencyReadiness(ticket, state);
    if (!readiness.ready) {
      ticket.status = "WAITING_DEPENDENCY";
      ticket.waiting_reason = readiness.reason;
      ticket.error = null;
      return ticket;
    }
    const project = registry.projects[ticket.project_id];
    if (!project) throw new Error(`Unknown project: ${ticket.project_id}`);
    const profile = profiles[ticket.project_id];
    if (!profile) throw new Error(`Approved onboarding profile required: ${ticket.project_id}`);
    const diagnosis = inspectGitProject(project.path, runGit);
    if (profile.git.dirty || diagnosis.dirty) {
      throw new Error(`Original project worktree is dirty: ${ticket.project_id}; resolve changes and repeat onboarding and request approval`);
    }
    for (const dependency of readiness.dependencies) {
      const dependencyProject = registry.projects[dependency.project_id];
      if (!dependencyProject) throw new Error(`Unknown dependency project: ${dependency.project_id}`);
      const recorded = dependency.release_history?.some((entry) => entry.operation === "commit" && entry.commit === dependency.committed_sha);
      if (!recorded) throw new Error(`Dependency commit lacks managed release evidence: ${dependency.ticket_id}`);
      requireGitSuccess(["cat-file", "-e", `${dependency.committed_sha}^{commit}`], dependencyProject.path);
    }
    const syncedSnapshot = state.synced_project_snapshots?.[ticket.project_id] || null;
    let baseCommit = syncedSnapshot?.head || profile.git.head;
    if (readiness.base_commit) {
      const dependency = state.tickets.find((item) => item.ticket_id === readiness.base_ticket);
      const branchHead = requireGitSuccess(["rev-parse", `refs/heads/${dependency.branch}`], project.path);
      if (branchHead !== readiness.base_commit) throw new Error(`Dependency branch moved after managed commit: ${readiness.base_ticket}`);
      const ancestor = runGit(["merge-base", "--is-ancestor", baseCommit, readiness.base_commit], project.path);
      if (ancestor.error || ancestor.status !== 0) throw new Error(`Dependency commit is not based on the approved project snapshot: ${readiness.base_ticket}`);
      if (diagnosis.dirty) throw new Error(`Original project worktree changed before dependency advance: ${ticket.project_id}`);
      baseCommit = readiness.base_commit;
    } else {
      assertProjectSnapshot(profile, diagnosis, syncedSnapshot);
    }
    if (fs.existsSync(ticket.worktree)) throw new Error(`Worktree path already exists: ${ticket.worktree}`);
    const branchCheck = runGit(["show-ref", "--verify", "--quiet", `refs/heads/${ticket.branch}`], project.path);
    if (branchCheck.status === 0) throw new Error(`Execution branch already exists: ${ticket.branch}`);
    requireGitSuccess(["worktree", "add", "-b", ticket.branch, ticket.worktree, baseCommit], project.path);
    ticket.base_commit = baseCommit;
    ticket.status = "PREPARED";
    ticket.error = null;
    delete ticket.waiting_reason;
    return ticket;
  };
  const selectTickets = (state, rawTicket) => {
    if (!rawTicket) return state.tickets;
    if (rawTicket === true) throw new Error("--ticket requires at least one ticket id");
    const ticketIds = [...new Set(String(rawTicket).split(",").map((value) => validateProjectId(value.trim())).filter(Boolean))];
    if (ticketIds.length === 0) throw new Error("--ticket requires at least one ticket id");
    return ticketIds.map((ticketId) => {
      const found = state.tickets.find((item) => item.ticket_id === ticketId);
      if (!found) throw new Error(`Unknown execution ticket: ${ticketId}`);
      return found;
    });
  };
  const syncTicketBase = (ticket, diagnosis, resetReview) => {
    if (ticket.status === "COMPLETED") return false;
    if (["BLOCKED", "RUNNING", "VERIFYING"].includes(ticket.status)) {
      throw new Error(`Cannot sync-base ticket in ${ticket.status} state: ${ticket.ticket_id}`);
    }
    if (ticket.status === "WAITING_DEPENDENCY") return false;
    if (ticket.status === "REVIEW_READY") {
      if (ticket.base_commit === diagnosis.head) return false;
      if (!resetReview) {
        throw new Error(`Ticket is REVIEW_READY; pass --reset-review to rebase onto new base and require fresh verification: ${ticket.ticket_id}`);
      }
    }
    if (ticket.base_commit === diagnosis.head) return false;
    if (!fs.existsSync(ticket.worktree)) throw new Error(`Worktree missing for sync-base: ${ticket.worktree}`);
    if (requireGitSuccess(["status", "--porcelain=v1", "--untracked-files=all"], ticket.worktree)) {
      throw new Error(`Sync-base requires a clean ticket worktree: ${ticket.ticket_id}`);
    }
    const branch = requireGitSuccess(["branch", "--show-current"], ticket.worktree);
    if (branch !== ticket.branch) throw new Error(`Sync-base branch mismatch for ${ticket.ticket_id}: ${branch}`);
    const rebase = runGit(["rebase", diagnosis.head], ticket.worktree);
    if (rebase.error || rebase.status !== 0) {
      runGit(["rebase", "--abort"], ticket.worktree);
      throw new Error(`Rebase conflict syncing ${ticket.ticket_id} onto ${diagnosis.head}; resolve manually or inspect branch`);
    }
    ticket.base_commit = diagnosis.head;
    if (ticket.status === "REVIEW_READY" && resetReview) {
      ticket.status = "PREPARED";
      delete ticket.verification;
      ticket.error = null;
    }
    return true;
  };
  const parseClosureEvidence = (options) => {
    const summary = typeof options.summary === "string" ? options.summary.trim() : "";
    if (!summary) throw new Error("execution complete requires --summary \"...\"");
    const pr = options.pr && options.pr !== true ? String(options.pr).trim() : null;
    const commit = options.commit && options.commit !== true ? String(options.commit).trim() : null;
    if (!pr && !commit) throw new Error("execution complete requires external release evidence (--pr or --commit)");
    if (pr && /[\r\n\0]/.test(pr)) throw new Error("Invalid PR reference");
    if (commit && !/^[a-f0-9]{7,40}$/i.test(commit)) throw new Error("Invalid commit SHA for --commit");
    return { summary, pr, commit };
  };
  function commandExecution(args) {
    const { positional, options } = parseArgs(args);
    const [action, rawId] = positional;
    const id = validateProjectId(rawId);
    if (action === "status") {
      const file = statePath(id);
      if (!fs.existsSync(file)) throw new Error(`Unknown execution: ${id}`);
      const state = readJson(file, null);
      log(JSON.stringify(state, null, 2));
      return state;
    }
    if (action === "complete") {
      const file = statePath(id);
      if (!fs.existsSync(file)) throw new Error(`Unknown execution: ${id}`);
      const evidence = parseClosureEvidence(options);
      const plan = readPlan(path.join(local, "requests", `${id}.json`), { fresh: false });
      const registry = readRegistry(path.join(local, "projects.json"));
      return withFileLock(`${file}.operation`, () => {
        const current = readJson(file, null);
        if (!current) throw new Error(`Unknown execution: ${id}`);
        assertExecutionMatchesPlan(current, plan, root);
        const selected = options.ticket
          ? selectTickets(current, options.ticket)
          : current.tickets.filter((ticket) => ticket.status !== "COMPLETED");
        if (selected.length === 0) throw new Error(`All tickets are already COMPLETED for ${id}`);
        for (const ticket of selected) {
          if (ticket.status !== "REVIEW_READY" || !ticket.verification?.content_fingerprint) {
            throw new Error(`Ticket must be REVIEW_READY with verification evidence before completion: ${ticket.ticket_id}`);
          }
          if (Array.isArray(ticket.verification.results) && ticket.verification.results.some((item) => item.status !== 0)) {
            throw new Error(`Ticket verification did not pass: ${ticket.ticket_id}`);
          }
          if (evidence.commit) {
            const project = registry.projects[ticket.project_id];
            if (project?.path && fs.existsSync(project.path)) {
              requireGitSuccess(["cat-file", "-e", `${evidence.commit}^{commit}`], project.path);
            }
          }
        }
        const now = new Date().toISOString();
        const updated = updateJsonLocked(file, null, (state) => {
          const targets = selectTickets(state, options.ticket || selected.map((ticket) => ticket.ticket_id).join(","));
          for (const ticket of targets) {
            ticket.status = "COMPLETED";
            ticket.completed_at = now;
            if (evidence.commit && !ticket.committed_sha) ticket.committed_sha = evidence.commit;
            ticket.external_release = {
              summary: evidence.summary,
              ...(evidence.pr ? { pr: evidence.pr } : {}),
              ...(evidence.commit ? { commit: evidence.commit } : {}),
              recorded_at: now
            };
          }
          return finalizeExecutionState(state, now);
        });
        log(`[${updated.status}] Completed ${selected.length} ticket(s) for ${id}`);
        return updated;
      }, { ttlMs: 120_000 });
    }
    if (action === "sync-base") {
      return withFileLock(`${statePath(id)}.operation`, () => {
        const file = statePath(id);
        const current = readJson(file, null);
        if (!current) throw new Error(`Unknown execution: ${id}`);
        const { plan, registry, profiles } = loadExecutionInputs(id, { fresh: false });
        assertExecutionMatchesPlan(current, plan, root);
        const selected = selectTickets(current, options.ticket);
        const projectIds = [...new Set(selected.filter((ticket) => ticket.status !== "COMPLETED").map((ticket) => ticket.project_id))];
        const diagnoses = {};
        for (const projectId of projectIds) {
          const project = registry.projects[projectId];
          const profile = profiles[projectId];
          if (!project || !profile || profile.status !== "APPROVED") throw new Error(`Approved project profile required: ${projectId}`);
          const diagnosis = inspectGitProject(project.path, runGit);
          if (profile.git.dirty || diagnosis.dirty) throw new Error(`Original project worktree is dirty: ${projectId}`);
          if (diagnosis.head !== profile.git.head) {
            const ancestor = runGit(["merge-base", "--is-ancestor", profile.git.head, diagnosis.head], project.path);
            if (ancestor.error || ancestor.status !== 0) throw new Error(`Project HEAD history diverged from approved snapshot: ${projectId}`);
          }
          diagnoses[projectId] = diagnosis;
        }
        const resetReview = Boolean(options["reset-review"]);
        let syncedCount = 0;
        const now = new Date().toISOString();
        const updated = updateJsonLocked(file, null, (state) => {
          const targets = selectTickets(state, options.ticket);
          for (const ticket of targets) {
            const diagnosis = diagnoses[ticket.project_id];
            if (diagnosis && syncTicketBase(ticket, diagnosis, resetReview)) syncedCount += 1;
          }
          state.synced_project_snapshots = {
            ...(state.synced_project_snapshots || {}),
            ...Object.fromEntries(Object.entries(diagnoses).map(([projectId, diagnosis]) => [projectId, {
              head: diagnosis.head,
              worktree_fingerprint: diagnosis.worktree_fingerprint,
              synced_at: now
            }]))
          };
          return finalizeExecutionState(state, now);
        });
        log(`[${updated.status}] Synced ${syncedCount} worktree(s) for ${id}`);
        return updated;
      }, { ttlMs: 120_000 });
    }
    if (action === "review-ready") {
      const file = statePath(id);
      if (!fs.existsSync(file)) throw new Error(`Unknown execution: ${id}`);
      if (!options.ticket) throw new Error("review-ready requires --ticket");
      assertExecutionMatchesPlan(readJson(file, null), readPlan(path.join(local, "requests", `${id}.json`), { fresh: false }), root);
      const leaseId = crypto.randomUUID();
      const claimed = updateJsonLocked(file, null, (state) => {
        if (!state) throw new Error(`Unknown execution: ${id}`);
        const ticket = state.tickets.find((item) => item.ticket_id === options.ticket);
        if (!ticket) throw new Error(`Unknown execution ticket: ${options.ticket}`);
        if (ticket.status !== "PREPARED") throw new Error(`Ticket must be PREPARED before review: ${ticket.ticket_id}`);
        const incompleteDependencies = (ticket.depends_on || []).filter((dependency) => {
          const depTicket = state.tickets.find((item) => item.ticket_id === dependency);
          return !depTicket?.committed_sha && depTicket?.status !== "COMPLETED";
        });
        if (incompleteDependencies.length > 0) throw new Error(`Ticket dependencies are not committed: ${incompleteDependencies.join(", ")}`);
        if (!isArtifactTicket(ticket) && (!Array.isArray(ticket.verification_commands) || ticket.verification_commands.length === 0)) {
          throw new Error(`Ticket has no verification commands: ${ticket.ticket_id}`);
        }
        ticket.status = "VERIFYING";
        ticket.verification_lease = leaseId;
        ticket.verification_owner = createVerificationOwner();
        state.status = "IN_PROGRESS";
        state.updated_at = new Date().toISOString();
        return state;
      });
      const claimedTicket = claimed.tickets.find((item) => item.ticket_id === options.ticket);
      let results;
      let fingerprint;
      let artifactVerification;
      try {
        const before = reviewFingerprint(claimedTicket.worktree);
        if (!before) throw new Error(`Could not fingerprint worktree: ${claimedTicket.worktree}`);
        if (claimedTicket.context_refs?.length) buildProjectContextBundle({ id: claimedTicket.project_id, path: claimedTicket.worktree }, { ticket: claimedTicket, historyRoot: root });
        if (isArtifactTicket(claimedTicket)) artifactVerification = verifyArtifactTicket(claimedTicket, runGit);
        results = claimedTicket.verification_commands.map((commandLine) => {
          const parts = tokenizeCommand(commandLine);
          const command = parts[0] === "npm" && process.platform === "win32" ? "npm.cmd" : parts[0];
          const started = Date.now();
          const result = runCommand(command, parts.slice(1), { cwd: claimedTicket.worktree, capture: true });
          const record = {
            command: commandLine,
            status: result.status,
            duration_ms: Math.max(0, Date.now() - started),
            stdout: String(result.stdout || "").slice(-4000),
            stderr: String(result.stderr || "").slice(-4000)
          };
          if (result.error || result.status !== 0) {
            throw new Error(`Verification failed for ${claimedTicket.ticket_id}: ${commandLine}\n${record.stderr || record.stdout}`);
          }
          return record;
        });
        fingerprint = reviewFingerprint(claimedTicket.worktree);
        if (!fingerprint || fingerprint !== before) throw new Error("Worktree changed during verification; reverify required");
      } catch (error) {
        updateJsonLocked(file, null, (state) => {
          const ticket = state.tickets.find((item) => item.ticket_id === options.ticket);
          if (ticket?.verification_lease === leaseId) {
            ticket.status = "PREPARED";
            delete ticket.verification_lease;
            delete ticket.verification_owner;
            delete ticket.verification;
            ticket.error = error.message;
            finalizeExecutionState(state);
          }
          return state;
        });
        throw error;
      }
      const state = updateJsonLocked(file, null, (current) => {
        const ticket = current.tickets.find((item) => item.ticket_id === options.ticket);
        if (ticket?.verification_lease !== leaseId) throw new Error(`Verification lease changed for ticket: ${options.ticket}`);
        ticket.status = "REVIEW_READY";
        delete ticket.verification_lease;
        delete ticket.verification_owner;
        ticket.error = null;
        ticket.verification = {
          ...(artifactVerification || { mode: "commands" }),
          summary: artifactVerification ? artifactVerification.summary : `${results.length} verification command(s) passed`,
          results,
          content_fingerprint: fingerprint,
          recorded_at: new Date().toISOString()
        };
        return finalizeExecutionState(current);
      });
      const completedTicket = state.tickets.find((item) => item.ticket_id === options.ticket);
      log(`[${state.status}] ${completedTicket.project_id}:${completedTicket.ticket_id} is ready for review`);
      return state;
    }
    if (!new Set(["prepare", "advance"]).has(action)) throw new Error("Usage: execution <prepare|advance|sync-base|review-ready|complete|status> <request-id>");

    return withFileLock(`${statePath(id)}.operation`, () => {
      const { plan, registry, profiles } = loadExecutionInputs(id, { fresh: action === "prepare" });
      if (action === "prepare") {
        let state = buildExecutionState(plan, root);
        updateJsonLocked(statePath(id), null, (existing) => {
          if (existing) throw new Error(`Execution already exists: ${id}`);
          return state;
        });
        for (const ticketState of state.tickets) {
          try {
            prepareTicket(ticketState, state, registry, profiles);
          } catch (error) {
            ticketState.status = "BLOCKED";
            ticketState.error = error.message;
          }
          state = updateJsonLocked(statePath(id), null, (current) => {
            const currentTicket = current.tickets.find((item) => item.ticket_id === ticketState.ticket_id);
            Object.assign(currentTicket, ticketState);
            return finalizeExecutionState(current);
          });
        }
        state = updateJsonLocked(statePath(id), null, (current) => finalizeExecutionState(current));
        log(`[${state.status}] Execution ${state.execution_id}: ${state.tickets.filter((ticket) => ticket.status === "PREPARED").length}/${state.tickets.length} worktrees prepared`);
        return state;
      }

      let state = readJson(statePath(id), null);
      if (!state) throw new Error(`Unknown execution: ${id}`);
      assertExecutionMatchesPlan(state, plan, root);
      let advanced = 0;
      for (const waiting of state.tickets.filter((ticket) => ticket.status === "WAITING_DEPENDENCY")) {
        const ticketState = JSON.parse(JSON.stringify(waiting));
        try {
          prepareTicket(ticketState, state, registry, profiles);
          if (ticketState.status === "PREPARED") advanced += 1;
        } catch (error) {
          ticketState.status = "BLOCKED";
          ticketState.error = error.message;
        }
        state = updateJsonLocked(statePath(id), null, (current) => {
          const currentTicket = current.tickets.find((item) => item.ticket_id === ticketState.ticket_id);
          Object.assign(currentTicket, ticketState);
          return finalizeExecutionState(current);
        });
      }
      state = updateJsonLocked(statePath(id), null, (current) => finalizeExecutionState(current));
      log(`[${state.status}] Dependency wave advanced ${advanced} ticket(s) for ${id}`);
      return state;
    }, { ttlMs: 120_000 });
  }
  return function guardedExecution(args) {
    const { positional } = parseArgs(args);
    if (!new Set(["prepare", "advance", "review-ready", "sync-base"]).has(positional[0])) return commandExecution(args);
    const fresh = positional[0] === "prepare";
    const id = validateProjectId(positional[1]);
    const file = path.join(local, "requests", `${id}.json`);
    const plan = readPlan(file, { fresh });
    if (!plan.tickets.some((ticket) => ticket.source?.kind === "jira")) return commandExecution(args);
    return requireJiraFresh(root, plan, { env, fetchImpl }).then(() => {
      if (readPlan(file, { fresh }).content_fingerprint !== plan.content_fingerprint) throw new Error("Request changed during Jira check");
      return commandExecution(args);
    });
  };
}

module.exports = { createExecutionCommand };
