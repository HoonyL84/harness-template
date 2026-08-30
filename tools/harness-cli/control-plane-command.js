"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { addEvidence, approveRelease, consumeReleaseApproval, createReleaseApproval, exportEvidenceMarkdown, publicVerifiedEvidence, searchEvidence, validateEvidenceReference } = require("./governance-ledger");
const { readRegistry, validateProjectId } = require("./project-registry");

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, filePath);
}
const readJson = (filePath, fallback) => fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, "utf8")) : fallback;
const readJsonDirectory = (directory) => fs.existsSync(directory)
  ? fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort().map((name) => readJson(path.join(directory, name), null))
  : [];

function createControlPlaneCommands({ root, parseArgs, notify, reviewFingerprint, runGit, log }) {
  if (typeof reviewFingerprint !== "function") throw new Error("reviewFingerprint is required");
  if (typeof runGit !== "function") throw new Error("runGit is required");
  const local = path.join(root, ".harness", "local");
  const ledgerPath = path.join(local, "career", "ledger.json");
  const eventPath = path.join(local, "notifications", "sent.json");
  const release = (args) => {
    const { positional, options } = parseArgs(args);
    const [action, rawId] = positional;
    const id = validateProjectId(rawId);
    const recordPath = path.join(local, "releases", `${id}.json`);
    if (action === "request") {
      const execution = readJson(path.join(local, "executions", `${id}.json`), null);
      if (!execution) throw new Error(`Unknown execution: ${id}`);
      for (const ticket of execution.tickets) {
        if (!fs.existsSync(ticket.worktree)) throw new Error(`Worktree missing: ${ticket.worktree}`);
        if (ticket.status !== "REVIEW_READY" || !ticket.verification?.content_fingerprint) {
          throw new Error(`Ticket is not review-ready: ${ticket.ticket_id}`);
        }
        ticket.review_fingerprint = reviewFingerprint(ticket.worktree);
        if (!ticket.review_fingerprint) throw new Error(`Could not fingerprint worktree: ${ticket.worktree}`);
        if (ticket.review_fingerprint !== ticket.verification.content_fingerprint) {
          throw new Error(`Worktree changed after verification: ${ticket.ticket_id}`);
        }
      }
      const record = createReleaseApproval(execution, options.summary);
      atomicWrite(recordPath, record);
      log(`[APPROVAL_REQUIRED] ${id} ${record.fingerprint}`);
      return record;
    }
    const record = readJson(recordPath, null);
    if (!record) throw new Error(`Unknown release approval: ${id}`);
    if (action === "approve") {
      const value = approveRelease(record, options.fingerprint);
      atomicWrite(recordPath, value); log(`[APPROVED] ${id}`); return value;
    }
    if (action === "consume") {
      for (const ticket of record.tickets) {
        if (reviewFingerprint(ticket.worktree) !== ticket.review_fingerprint) throw new Error(`Worktree changed after release approval: ${ticket.ticket_id}`);
      }
      const value = consumeReleaseApproval(record, options.fingerprint);
      atomicWrite(recordPath, value); log(`[CONSUMED] ${id}`); return value;
    }
    if (action === "status") { log(JSON.stringify(record, null, 2)); return record; }
    throw new Error("Usage: release <request|approve|consume|status> <request-id>");
  };
  const evidence = (args) => {
    const { positional, options } = parseArgs(args);
    let ledger = readJson(ledgerPath, []);
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
      ledger = addEvidence(ledger, item);
      atomicWrite(ledgerPath, ledger); log(`[EVIDENCE] ${ledger.at(-1).id}`); return ledger.at(-1);
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
    const requests = readJsonDirectory(path.join(local, "requests"));
    const executions = readJsonDirectory(path.join(local, "executions"));
    const releases = readJsonDirectory(path.join(local, "releases"));
    const lines = requests.filter((request) => !executions.some((state) => state.request_id === request.request_id)).map((request) => (
      `${request.request_id}: ${request.status === "DRAFT" ? "PLAN_READY" : `PLAN_${request.status}`}\nNext: ${request.status === "DRAFT" ? "review and approve the plan" : "prepare project worktrees"}`
    ));
    lines.push(...executions.map((state) => {
      const blocked = state.tickets.filter((ticket) => ticket.status === "BLOCKED");
      if (blocked.length) return `${state.request_id}: BLOCKED\nEvidence: ${blocked.map((ticket) => `${ticket.ticket_id}=${ticket.error}`).join("; ")}\nNext: revise plan, refresh onboarding, or retry after resolving the cause`;
      if (state.status === "REVIEW_READY") return `${state.request_id}: REVIEW_READY\nNext: review diff/tests and explicitly request release approval`;
      return `${state.request_id}: ${state.status}`;
    }));
    lines.push(...releases.map((release) => {
      if (release.status === "PENDING") return `${release.request_id}: APPROVAL_REQUIRED\nFingerprint: ${release.fingerprint}\nNext: approve only after reviewing the release summary and worktree changes`;
      if (release.status === "APPROVED") return `${release.request_id}: RELEASE_APPROVED\nNext: consume the one-time approval immediately before the managed Git operation`;
      return `${release.request_id}: RELEASE_${release.status}`;
    }));
    const summary = lines.join("\n\n") || "No active executions";
    const eventId = crypto.createHash("sha256").update(summary).digest("hex");
    const sent = readJson(eventPath, []);
    if (!sent.includes(eventId)) {
      const blocked = executions.some((state) => state.tickets.some((ticket) => ticket.status === "BLOCKED"));
      const result = await notify(blocked ? "fail" : "success", summary, "multi-project-dashboard");
      if (result?.sent > 0) atomicWrite(eventPath, [...sent, eventId].slice(-100));
    }
    log(summary);
    return { requests, executions, releases, duplicate: sent.includes(eventId) };
  };
  return { dashboard, evidence, release };
}
module.exports = { createControlPlaneCommands };
