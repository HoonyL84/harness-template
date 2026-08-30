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

function createExecutionCommand({ root, parseArgs, reviewFingerprint, runCommand, runGit, tokenizeCommand, log }) {
  const local = path.join(root, ".harness", "local");
  const statePath = (id) => path.join(local, "executions", `${validateProjectId(id)}.json`);
  const requireGitSuccess = (args, cwd) => {
    const result = runGit(args, cwd);
    if (result.error || result.status !== 0) throw new Error(String(result.stderr || result.error?.message || `git ${args.join(" ")} failed`).trim());
    return String(result.stdout || "").trim();
  };
  const loadExecutionInputs = (id) => {
    const plan = readPlan(path.join(local, "requests", `${id}.json`));
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
    for (const dependency of readiness.dependencies) {
      const dependencyProject = registry.projects[dependency.project_id];
      if (!dependencyProject) throw new Error(`Unknown dependency project: ${dependency.project_id}`);
      const recorded = dependency.release_history?.some((entry) => entry.operation === "commit" && entry.commit === dependency.committed_sha);
      if (!recorded) throw new Error(`Dependency commit lacks managed release evidence: ${dependency.ticket_id}`);
      requireGitSuccess(["cat-file", "-e", `${dependency.committed_sha}^{commit}`], dependencyProject.path);
    }
    let baseCommit = profile.git.head;
    if (readiness.base_commit) {
      const dependency = state.tickets.find((item) => item.ticket_id === readiness.base_ticket);
      const branchHead = requireGitSuccess(["rev-parse", `refs/heads/${dependency.branch}`], project.path);
      if (branchHead !== readiness.base_commit) throw new Error(`Dependency branch moved after managed commit: ${readiness.base_ticket}`);
      const ancestor = runGit(["merge-base", "--is-ancestor", profile.git.head, readiness.base_commit], project.path);
      if (ancestor.error || ancestor.status !== 0) throw new Error(`Dependency commit is not based on the approved project snapshot: ${readiness.base_ticket}`);
      if (diagnosis.dirty) throw new Error(`Original project worktree changed before dependency advance: ${ticket.project_id}`);
      baseCommit = readiness.base_commit;
    } else {
      assertProjectSnapshot(profile, diagnosis);
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
  return function commandExecution(args) {
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
    if (action === "review-ready") {
      const file = statePath(id);
      if (!fs.existsSync(file)) throw new Error(`Unknown execution: ${id}`);
      if (!options.ticket) throw new Error("review-ready requires --ticket");
      assertExecutionMatchesPlan(readJson(file, null), readPlan(path.join(local, "requests", `${id}.json`)), root);
      const leaseId = crypto.randomUUID();
      const claimed = updateJsonLocked(file, null, (state) => {
        if (!state) throw new Error(`Unknown execution: ${id}`);
        const ticket = state.tickets.find((item) => item.ticket_id === options.ticket);
        if (!ticket) throw new Error(`Unknown execution ticket: ${options.ticket}`);
        if (ticket.status !== "PREPARED") throw new Error(`Ticket must be PREPARED before review: ${ticket.ticket_id}`);
        const incompleteDependencies = (ticket.depends_on || []).filter((dependency) => !state.tickets.find((item) => item.ticket_id === dependency)?.committed_sha);
        if (incompleteDependencies.length > 0) throw new Error(`Ticket dependencies are not committed: ${incompleteDependencies.join(", ")}`);
        if (!Array.isArray(ticket.verification_commands) || ticket.verification_commands.length === 0) {
          throw new Error(`Ticket has no verification commands: ${ticket.ticket_id}`);
        }
        ticket.status = "VERIFYING";
        ticket.verification_lease = leaseId;
        state.status = "IN_PROGRESS";
        state.updated_at = new Date().toISOString();
        return state;
      });
      const claimedTicket = claimed.tickets.find((item) => item.ticket_id === options.ticket);
      let results;
      try {
        results = claimedTicket.verification_commands.map((commandLine) => {
          const parts = tokenizeCommand(commandLine);
          const command = parts[0] === "npm" && process.platform === "win32" ? "npm.cmd" : parts[0];
          const result = runCommand(command, parts.slice(1), { cwd: claimedTicket.worktree, capture: true });
          const record = {
            command: commandLine,
            status: result.status,
            stdout: String(result.stdout || "").slice(-4000),
            stderr: String(result.stderr || "").slice(-4000)
          };
          if (result.error || result.status !== 0) {
            throw new Error(`Verification failed for ${claimedTicket.ticket_id}: ${commandLine}\n${record.stderr || record.stdout}`);
          }
          return record;
        });
      } catch (error) {
        updateJsonLocked(file, null, (state) => {
          const ticket = state.tickets.find((item) => item.ticket_id === options.ticket);
          if (ticket?.verification_lease === leaseId) {
            ticket.status = "PREPARED";
            delete ticket.verification_lease;
            finalizeExecutionState(state);
          }
          return state;
        });
        throw error;
      }
      const fingerprint = reviewFingerprint(claimedTicket.worktree);
      if (!fingerprint) {
        updateJsonLocked(file, null, (current) => {
          const ticket = current.tickets.find((item) => item.ticket_id === options.ticket);
          if (ticket?.verification_lease === leaseId) {
            ticket.status = "PREPARED";
            delete ticket.verification_lease;
            finalizeExecutionState(current);
          }
          return current;
        });
        throw new Error(`Could not fingerprint worktree: ${claimedTicket.worktree}`);
      }
      const state = updateJsonLocked(file, null, (current) => {
        const ticket = current.tickets.find((item) => item.ticket_id === options.ticket);
        if (ticket?.verification_lease !== leaseId) throw new Error(`Verification lease changed for ticket: ${options.ticket}`);
        ticket.status = "REVIEW_READY";
        delete ticket.verification_lease;
        ticket.verification = {
          summary: `${results.length} verification command(s) passed`,
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
    if (!new Set(["prepare", "advance"]).has(action)) throw new Error("Usage: execution <prepare|advance|review-ready|status> <request-id>");

    return withFileLock(`${statePath(id)}.operation`, () => {
      const { plan, registry, profiles } = loadExecutionInputs(id);
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
  };
}

module.exports = { createExecutionCommand };
