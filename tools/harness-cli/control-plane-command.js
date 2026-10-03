"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readJson, readJsonDirectory, updateJsonLocked, withFileLockAsync, writeJsonAtomic } = require("./control-plane-state");
const { addEvidence, approveRelease, beginReleaseApply, consumeReleaseApproval, createReleaseApproval, exportEvidenceMarkdown, failReleaseApply, finishReleaseApply, normalizeReleaseSpec, publicVerifiedEvidence, requireReleaseApproved, searchEvidence, upsertManagedCommitDraft, validateEvidenceReference } = require("./governance-ledger");
const { readRegistry, validateProjectId } = require("./project-registry");
const { assertExecutionMatchesPlan } = require("./project-execution");
const { readPlan } = require("./request-command");
const { requireJiraFresh } = require("./jira-input");
const { requireAcceptedReview } = require("./work-history");
const { assertArtifactEvidence, isArtifactTicket } = require("./ticket-artifacts");

function createControlPlaneCommands({ root, parseArgs, notify, reviewFingerprint, runGit, log, env = process.env, fetchImpl = globalThis.fetch }) {
  if (typeof reviewFingerprint !== "function") throw new Error("reviewFingerprint is required");
  if (typeof runGit !== "function") throw new Error("runGit is required");
  const local = path.join(root, ".harness", "local");
  const ledgerPath = path.join(local, "career", "ledger.json");
  const eventPath = path.join(local, "notifications", "sent.json");
  const requireGitSuccess = (args, cwd) => {
    const result = runGit(args, cwd);
    if (result.error || result.status !== 0) throw new Error(String(result.stderr || result.error?.message || `git ${args.join(" ")} failed`).trim());
    return String(result.stdout || "").trim();
  };
  const requireCommittedWorktree = (ticket) => {
    const branch = requireGitSuccess(["branch", "--show-current"], ticket.worktree);
    if (branch !== ticket.branch) throw new Error(`Managed release branch mismatch for ${ticket.ticket_id}: ${branch}`);
    if (requireGitSuccess(["rev-parse", "HEAD"], ticket.worktree) !== ticket.committed_sha) {
      throw new Error(`Managed commit is no longer the branch HEAD: ${ticket.ticket_id}`);
    }
    if (requireGitSuccess(["status", "--porcelain=v1", "--untracked-files=all"], ticket.worktree)) {
      throw new Error(`Managed release requires a clean ticket worktree: ${ticket.ticket_id}`);
    }
  };
  const applyManagedRelease = (record) => {
    const results = [];
    const registry = readRegistry(path.join(local, "projects.json"));
    for (const ticket of record.tickets) {
      if (reviewFingerprint(ticket.worktree) !== ticket.review_fingerprint) throw Object.assign(new Error(`Worktree changed after release approval: ${ticket.ticket_id}`), { partialResults: results });
      const operation = record.release.operation;
      try {
        if (operation === "commit") {
          const branch = requireGitSuccess(["branch", "--show-current"], ticket.worktree);
          if (branch !== ticket.branch) throw new Error(`Managed commit branch mismatch for ${ticket.ticket_id}: ${branch}`);
          if (!requireGitSuccess(["status", "--porcelain=v1", "--untracked-files=all"], ticket.worktree)) throw new Error(`Managed commit has no changes: ${ticket.ticket_id}`);
          requireGitSuccess(["add", "--all"], ticket.worktree);
          requireGitSuccess(["commit", "-m", record.release.message], ticket.worktree);
          results.push({ ticket_id: ticket.ticket_id, project_id: ticket.project_id, operation, commit: requireGitSuccess(["rev-parse", "HEAD"], ticket.worktree) });
        } else if (operation === "push") {
          requireCommittedWorktree(ticket);
          requireGitSuccess(["push", "-u", record.release.remote, ticket.branch], ticket.worktree);
          results.push({ ticket_id: ticket.ticket_id, project_id: ticket.project_id, operation, remote: record.release.remote, branch: ticket.branch });
        } else if (operation === "merge") {
          requireCommittedWorktree(ticket);
          const project = registry.projects[ticket.project_id];
          if (!project) throw new Error(`Unknown project for managed merge: ${ticket.project_id}`);
          const branch = requireGitSuccess(["branch", "--show-current"], project.path);
          if (branch !== record.release.target_branch) throw new Error(`Managed merge target mismatch for ${ticket.ticket_id}: ${branch}`);
          if (requireGitSuccess(["status", "--porcelain=v1", "--untracked-files=all"], project.path)) throw new Error(`Managed merge requires a clean target worktree: ${ticket.project_id}`);
          requireGitSuccess(["merge", "--no-ff", ticket.branch, "-m", record.release.message], project.path);
          results.push({ ticket_id: ticket.ticket_id, project_id: ticket.project_id, operation, target_branch: record.release.target_branch, commit: requireGitSuccess(["rev-parse", "HEAD"], project.path) });
        }
      } catch (error) {
        error.partialResults = results;
        throw error;
      }
    }
    return results;
  };
  const recordManagedResults = (record, results) => {
    const executionPath = path.join(local, "executions", `${record.request_id}.json`);
    const execution = updateJsonLocked(executionPath, null, (execution) => {
      if (!execution) throw new Error(`Unknown execution: ${record.request_id}`);
      for (const result of results) {
        const ticket = execution.tickets.find((item) => item.ticket_id === result.ticket_id);
        if (!ticket) throw new Error(`Managed release ticket is missing from execution: ${result.ticket_id}`);
        if (result.operation === "commit") {
          const fingerprint = reviewFingerprint(ticket.worktree);
          if (!fingerprint) throw new Error(`Could not fingerprint committed worktree: ${ticket.ticket_id}`);
          ticket.verification.reviewed_content_fingerprint = record.tickets.find((item) => item.ticket_id === result.ticket_id).review_fingerprint;
          ticket.verification.content_fingerprint = fingerprint;
          ticket.committed_sha = result.commit;
        }
        ticket.release_history = [...(ticket.release_history || []), { approval_id: record.approval_id, ...result, recorded_at: new Date().toISOString() }].slice(-20);
      }
      return execution;
    });
    const registry = readRegistry(path.join(local, "projects.json"));
    for (const result of results.filter((item) => item.operation === "commit")) {
      const ticket = execution.tickets.find((item) => item.ticket_id === result.ticket_id);
      const project = registry.projects[result.project_id];
      if (ticket && project) {
        try {
          updateJsonLocked(ledgerPath, [], (ledger) => upsertManagedCommitDraft(ledger, {
            project,
            ticket,
            commit: result.commit,
            requestId: record.request_id,
            approvalId: record.approval_id
          }));
        } catch (error) {
          log(`[WARN] Managed commit succeeded but evidence draft could not be recorded: ${error.message}`);
        }
      }
    }
    return execution;
  };
  const release = (args) => {
    const { positional, options } = parseArgs(args);
    const [action, rawId] = positional;
    const requestId = validateProjectId(rawId);
    const id = action === "request" && options.approval ? validateProjectId(options.approval) : requestId;
    const recordPath = path.join(local, "releases", `${id}.json`);
    if (action === "request") {
      const execution = readJson(path.join(local, "executions", `${requestId}.json`), null);
      if (!execution) throw new Error(`Unknown execution: ${requestId}`);
      assertExecutionMatchesPlan(execution, readPlan(path.join(local, "requests", `${requestId}.json`)), root);
      const ticketIds = options.ticket && options.ticket !== true
        ? [...new Set(String(options.ticket).split(",").map((value) => validateProjectId(value.trim())).filter(Boolean))]
        : [];
      const selectedTickets = ticketIds.length === 0
        ? execution.tickets
        : ticketIds.map((ticketId) => {
          const ticket = execution.tickets.find((item) => item.ticket_id === ticketId);
          if (!ticket) throw new Error(`Unknown release ticket: ${ticketId}`);
          return ticket;
        });
      const operation = normalizeReleaseSpec({ operation: options.operation, message: options.message, remote: options.remote, targetBranch: options.target }).operation;
      for (const ticket of selectedTickets) {
        if (!fs.existsSync(ticket.worktree)) throw new Error(`Worktree missing: ${ticket.worktree}`);
        if (ticket.status !== "REVIEW_READY" || !ticket.verification?.content_fingerprint) {
          throw new Error(`Ticket is not review-ready: ${ticket.ticket_id}`);
        }
        if (isArtifactTicket(ticket)) assertArtifactEvidence(ticket);
        ticket.review_fingerprint = reviewFingerprint(ticket.worktree);
        if (!ticket.review_fingerprint) throw new Error(`Could not fingerprint worktree: ${ticket.worktree}`);
        if (ticket.review_fingerprint !== ticket.verification.content_fingerprint) {
          throw new Error(`Worktree changed after verification: ${ticket.ticket_id}`);
        }
        if (operation !== "record") {
          if (operation !== "commit" && (!ticket.committed_sha || !ticket.release_history?.some((entry) => entry.operation === "commit" && entry.commit === ticket.committed_sha))) {
            throw new Error(`Managed commit is required before ${operation}: ${ticket.ticket_id}`);
          }
          if (operation !== "commit") requireCommittedWorktree(ticket);
          const accepted = requireAcceptedReview(root, requestId, ticket,
            operation === "commit" ? [ticket.review_fingerprint]
              : [ticket.review_fingerprint, ticket.verification.reviewed_content_fingerprint].filter(Boolean));
          ticket.review_event_id = accepted.event_id;
        }
      }
      const record = createReleaseApproval(execution, options.summary, {
        operation: options.operation,
        message: options.message,
        remote: options.remote,
        targetBranch: options.target,
        approvalId: id,
        ticketIds
      });
      updateJsonLocked(recordPath, null, (existing) => {
        if (existing && !["CONSUMED", "FAILED"].includes(existing.status)) {
          throw new Error(`Release approval already exists: ${id}`);
        }
        return record;
      });
      log(`[APPROVAL_REQUIRED] ${id} ${record.fingerprint}`);
      return record;
    }
    const record = readJson(recordPath, null);
    if (!record) throw new Error(`Unknown release approval: ${id}`);
    const requireCurrentReviews = () => {
      if (record.release.operation === "record") return;
      const execution = readJson(path.join(local, "executions", `${record.request_id}.json`), null);
      for (const approved of record.tickets) {
        const ticket = execution?.tickets?.find((item) => item.ticket_id === approved.ticket_id && item.project_id === approved.project_id);
        if (!ticket || ticket.status !== "REVIEW_READY" || !approved.review_event_id) throw new Error(`Current accepted user review is required for ticket: ${approved.ticket_id}`);
        if (isArtifactTicket(ticket)) assertArtifactEvidence(ticket);
        if (record.release.operation !== "commit" && ticket.committed_sha !== approved.committed_sha) throw new Error(`Managed commit changed after release request: ${approved.ticket_id}`);
        requireAcceptedReview(root, record.request_id, ticket,
          record.release.operation === "commit" ? [approved.review_fingerprint]
            : [approved.review_fingerprint, ticket.verification?.reviewed_content_fingerprint].filter(Boolean), approved.review_event_id);
      }
    };
    if (action === "approve") {
      requireCurrentReviews();
      const value = updateJsonLocked(recordPath, null, (current) => approveRelease(current, options.fingerprint));
      log(`[APPROVED] ${id}`); return value;
    }
    if (action === "consume") {
      for (const ticket of readJson(recordPath, null).tickets) {
        if (reviewFingerprint(ticket.worktree) !== ticket.review_fingerprint) throw new Error(`Worktree changed after release approval: ${ticket.ticket_id}`);
      }
      const value = updateJsonLocked(recordPath, null, (current) => consumeReleaseApproval(current, options.fingerprint));
      log(`[CONSUMED] ${id}`); return value;
    }
    if (action === "apply") {
      requireCurrentReviews();
      for (const ticket of record.tickets) {
        if (reviewFingerprint(ticket.worktree) !== ticket.review_fingerprint) throw new Error(`Worktree changed after release approval: ${ticket.ticket_id}`);
      }
      requireReleaseApproved(record, options.fingerprint);
      const applying = updateJsonLocked(recordPath, null, (current) => beginReleaseApply(current, options.fingerprint));
      try {
        const results = applyManagedRelease(applying);
        try { recordManagedResults(applying, results); } catch (recordError) {
          recordError.partialResults = results;
          throw recordError;
        }
        const value = updateJsonLocked(recordPath, null, (current) => finishReleaseApply(current, results));
        log(`[APPLIED] ${id} ${value.release.operation}`);
        return value;
      } catch (error) {
        if (error.partialResults?.length) {
          try { recordManagedResults(applying, error.partialResults); } catch {
            // The FAILED release record retains partial Git evidence for manual reconciliation.
          }
        }
        updateJsonLocked(recordPath, null, (current) => failReleaseApply(current, error.message, error.partialResults));
        throw error;
      }
    }
    if (action === "status") { log(JSON.stringify(record, null, 2)); return record; }
    throw new Error("Usage: release <request|approve|apply|consume|status> <request-id>");
  };
  const evidence = (args) => {
    const { positional, options } = parseArgs(args);
    const ledger = readJson(ledgerPath, []);
    if (positional[0] === "add") {
      if (!options.file || options.file === true) throw new Error("evidence add requires --file <json>");
      const item = JSON.parse(fs.readFileSync(path.resolve(options.file), "utf8"));
      if (item.status === "VERIFIED") {
        validateEvidenceReference(item, {
          projects: readRegistry(path.join(local, "projects.json")).projects,
          executions: readJsonDirectory(path.join(local, "executions")),
          runGit
        });
      }
      const updated = updateJsonLocked(ledgerPath, [], (current) => addEvidence(current, item));
      log(`[EVIDENCE] ${updated.at(-1).id}`); return updated.at(-1);
    }
    if (positional[0] === "search") {
      const result = searchEvidence(ledger, options.query || "", {
        includeDrafts: Boolean(options["include-drafts"]),
        projectId: options.project,
        technology: options.technology,
        from: options.from,
        to: options.to
      });
      log(JSON.stringify(result, null, 2)); return result;
    }
    if (positional[0] === "export") {
      const verified = publicVerifiedEvidence(ledger);
      const output = options.format === "json" ? JSON.stringify(verified, null, 2) : exportEvidenceMarkdown(ledger);
      log(output); return output;
    }
    throw new Error("Usage: evidence <add|search|export>");
  };
  const dashboard = async () => {
    const bootstraps = readJsonDirectory(path.join(local, "bootstraps"));
    const requests = readJsonDirectory(path.join(local, "requests"));
    const executions = readJsonDirectory(path.join(local, "executions"));
    const releases = readJsonDirectory(path.join(local, "releases"));
    const lines = bootstraps.filter((bootstrap) => !["APPLIED", "SKIPPED"].includes(bootstrap.status)).map((bootstrap) => {
      if (bootstrap.status === "PENDING") return `${bootstrap.bootstrap_id}: PLAN_COMMIT_APPROVAL_REQUIRED\nFingerprint: ${bootstrap.fingerprint}\nNext: approve the initial plan commit`;
      if (bootstrap.status === "APPROVED") return `${bootstrap.bootstrap_id}: PLAN_COMMIT_APPROVED\nNext: apply the one-time bootstrap approval`;
      if (bootstrap.status === "FAILED") return `${bootstrap.bootstrap_id}: BOOTSTRAP_FAILED\nEvidence: ${bootstrap.result?.error || "unknown failure"}\nNext: inspect the repository and create a new bootstrap request`;
      return `${bootstrap.bootstrap_id}: BOOTSTRAP_${bootstrap.status}`;
    });
    lines.push(...requests.filter((request) => !executions.some((state) => state.request_id === request.request_id)).map((request) => (
      `${request.request_id}: ${request.status === "DRAFT" ? "PLAN_READY" : `PLAN_${request.status}`}\nNext: ${request.status === "DRAFT" ? "review and approve the plan" : "prepare project worktrees"}`
    )));
    lines.push(...executions.map((state) => {
      const blocked = state.tickets.filter((ticket) => ticket.status === "BLOCKED");
      if (blocked.length) return `${state.request_id}: BLOCKED\nEvidence: ${blocked.map((ticket) => `${ticket.ticket_id}=${ticket.error}`).join("; ")}\nNext: revise plan, refresh onboarding, or retry after resolving the cause`;
      if (state.status === "REVIEW_READY") return `${state.request_id}: REVIEW_READY\nNext: review diff/tests and explicitly request release approval`;
      const ready = state.tickets.filter((ticket) => ticket.status === "REVIEW_READY" && !ticket.committed_sha);
      if (ready.length) return `${state.request_id}: PARTIAL_REVIEW_READY\nTickets: ${ready.map((ticket) => ticket.ticket_id).join(", ")}\nNext: request a ticket-scoped commit approval, then advance the dependency wave`;
      const waiting = state.tickets.filter((ticket) => ticket.status === "WAITING_DEPENDENCY");
      if (waiting.length) return `${state.request_id}: WAITING_DEPENDENCY\nTickets: ${waiting.map((ticket) => `${ticket.ticket_id} (${ticket.waiting_reason})`).join("; ")}\nNext: commit the required predecessor ticket or approve an explicit integration ticket`;
      return `${state.request_id}: ${state.status}`;
    }));
    lines.push(...releases.map((release) => {
      if (release.status === "PENDING") return `${release.request_id}: APPROVAL_REQUIRED\nFingerprint: ${release.fingerprint}\nNext: approve only after reviewing the release summary and worktree changes`;
      if (release.status === "APPROVED") return `${release.request_id}: RELEASE_APPROVED\nNext: apply the one-time approval immediately before the managed Git operation`;
      return `${release.request_id}: RELEASE_${release.status}`;
    }));
    const summary = lines.join("\n\n") || "No active executions";
    const eventId = crypto.createHash("sha256").update(summary).digest("hex");
    const duplicate = await withFileLockAsync(eventPath, async () => {
      const sent = readJson(eventPath, []);
      if (sent.includes(eventId)) return true;
      const blocked = executions.some((state) => state.tickets.some((ticket) => ticket.status === "BLOCKED"));
      const result = await notify(blocked ? "fail" : "success", summary, "multi-project-dashboard");
      if (result?.sent > 0) writeJsonAtomic(eventPath, [...sent, eventId].slice(-100));
      return false;
    }, { ttlMs: 120_000 });
    log(summary);
    return { bootstraps, requests, executions, releases, duplicate };
  };
  const guardedRelease = (args) => {
    const { positional, options } = parseArgs(args);
    const [action, rawId] = positional;
    if (!new Set(["request", "approve", "apply", "consume"]).has(action)) return release(args);
    const id = validateProjectId(rawId);
    const file = path.join(local, action === "request" ? "requests" : "releases", `${id}.json`);
    const snapshot = action === "request" ? readPlan(file) : readJson(file, null);
    const ticketIds = action === "request" && options.ticket && options.ticket !== true
      ? String(options.ticket).split(",").map(value => value.trim()) : null;
    const tickets = (snapshot?.tickets || []).filter(ticket => !ticketIds || ticketIds.includes(ticket.ticket_id));
    if (!tickets.some(ticket => ticket.source?.kind === "jira")) return release(args);
    return requireJiraFresh(root, { tickets }, { env, fetchImpl }).then(() => {
      const current = readJson(file, null);
      if (JSON.stringify(current) !== JSON.stringify(snapshot)) throw new Error("Release inputs changed during Jira check");
      return release(args);
    });
  };
  return { dashboard, evidence, release: guardedRelease };
}
module.exports = { createControlPlaneCommands };
