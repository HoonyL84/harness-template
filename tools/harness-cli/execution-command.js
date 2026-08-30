"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readOnboardingProfile } = require("./project-onboarding");
const { assertProjectSnapshot, buildExecutionState, finalizeExecutionState } = require("./project-execution");
const { inspectGitProject, readRegistry, validateProjectId } = require("./project-registry");
const { readPlan } = require("./request-command");
const { requireRequestReady } = require("./request-plan");

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, filePath);
}

function createExecutionCommand({ root, parseArgs, reviewFingerprint, runCommand, runGit, tokenizeCommand, log }) {
  const local = path.join(root, ".harness", "local");
  const statePath = (id) => path.join(local, "executions", `${validateProjectId(id)}.json`);
  return function commandExecution(args) {
    const { positional, options } = parseArgs(args);
    const [action, rawId] = positional;
    const id = validateProjectId(rawId);
    if (action === "status") {
      const file = statePath(id);
      if (!fs.existsSync(file)) throw new Error(`Unknown execution: ${id}`);
      const state = JSON.parse(fs.readFileSync(file, "utf8"));
      log(JSON.stringify(state, null, 2));
      return state;
    }
    if (action === "review-ready") {
      const file = statePath(id);
      if (!fs.existsSync(file)) throw new Error(`Unknown execution: ${id}`);
      if (!options.ticket) throw new Error("review-ready requires --ticket");
      const state = JSON.parse(fs.readFileSync(file, "utf8"));
      const ticket = state.tickets.find((item) => item.ticket_id === options.ticket);
      if (!ticket) throw new Error(`Unknown execution ticket: ${options.ticket}`);
      if (ticket.status !== "PREPARED") throw new Error(`Ticket must be PREPARED before review: ${ticket.ticket_id}`);
      const incompleteDependencies = (ticket.depends_on || []).filter((dependency) => state.tickets.find((item) => item.ticket_id === dependency)?.status !== "REVIEW_READY");
      if (incompleteDependencies.length > 0) throw new Error(`Ticket dependencies are not review-ready: ${incompleteDependencies.join(", ")}`);
      if (!Array.isArray(ticket.verification_commands) || ticket.verification_commands.length === 0) {
        throw new Error(`Ticket has no verification commands: ${ticket.ticket_id}`);
      }
      const results = ticket.verification_commands.map((commandLine) => {
        const parts = tokenizeCommand(commandLine);
        const command = parts[0] === "npm" && process.platform === "win32" ? "npm.cmd" : parts[0];
        const result = runCommand(command, parts.slice(1), { cwd: ticket.worktree, capture: true });
        const record = {
          command: commandLine,
          status: result.status,
          stdout: String(result.stdout || "").slice(-4000),
          stderr: String(result.stderr || "").slice(-4000)
        };
        if (result.error || result.status !== 0) {
          throw new Error(`Verification failed for ${ticket.ticket_id}: ${commandLine}\n${record.stderr || record.stdout}`);
        }
        return record;
      });
      const fingerprint = reviewFingerprint(ticket.worktree);
      if (!fingerprint) throw new Error(`Could not fingerprint worktree: ${ticket.worktree}`);
      ticket.status = "REVIEW_READY";
      ticket.verification = {
        summary: `${results.length} verification command(s) passed`,
        results,
        content_fingerprint: fingerprint,
        recorded_at: new Date().toISOString()
      };
      finalizeExecutionState(state);
      atomicWrite(file, state);
      log(`[${state.status}] ${ticket.project_id}:${ticket.ticket_id} is ready for review`);
      return state;
    }
    if (action !== "prepare") throw new Error("Usage: execution <prepare|review-ready|status> <request-id>");

    const plan = readPlan(path.join(local, "requests", `${id}.json`));
    const registry = readRegistry(path.join(local, "projects.json"));
    const projectIds = [...new Set(plan.tickets.map((ticket) => ticket.project_id))];
    const profiles = Object.fromEntries(projectIds.map((projectId) => [
      projectId,
      readOnboardingProfile(path.join(local, "profiles", `${projectId}.json`))
    ]));
    requireRequestReady(plan, profiles);
    if (fs.existsSync(statePath(id))) throw new Error(`Execution already exists: ${id}`);
    const state = buildExecutionState(plan, root);
    atomicWrite(statePath(id), state);

    for (const ticketState of state.tickets) {
      try {
        const project = registry.projects[ticketState.project_id];
        if (!project) throw new Error(`Unknown project: ${ticketState.project_id}`);
        const diagnosis = inspectGitProject(project.path, runGit);
        const profile = profiles[ticketState.project_id];
        assertProjectSnapshot(profile, diagnosis);
        if (fs.existsSync(ticketState.worktree)) throw new Error(`Worktree path already exists: ${ticketState.worktree}`);
        const branchCheck = runGit(["show-ref", "--verify", "--quiet", `refs/heads/${ticketState.branch}`], project.path);
        if (branchCheck.status === 0) throw new Error(`Execution branch already exists: ${ticketState.branch}`);
        const created = runGit(["worktree", "add", "-b", ticketState.branch, ticketState.worktree, profile.git.head], project.path);
        if (created.error || created.status !== 0) throw new Error(String(created.stderr || created.error?.message || "git worktree add failed").trim());
        ticketState.base_commit = profile.git.head;
        ticketState.status = "PREPARED";
      } catch (error) {
        ticketState.status = "BLOCKED";
        ticketState.error = error.message;
      }
      atomicWrite(statePath(id), finalizeExecutionState(state));
    }
    finalizeExecutionState(state);
    atomicWrite(statePath(id), state);
    log(`[${state.status}] Execution ${state.execution_id}: ${state.tickets.filter((ticket) => ticket.status === "PREPARED").length}/${state.tickets.length} worktrees prepared`);
    return state;
  };
}

module.exports = { createExecutionCommand };
