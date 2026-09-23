"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { readJson, readJsonDirectory, updateJsonLocked } = require("./control-plane-state");
const { validateProjectId } = require("./project-registry");
const { safeCaptureFollowups } = require("./operations-followup");

const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const historyPath = root => path.join(root, ".harness", "local", "history", "ledger.json");
const emptyHistory = () => ({ schema_version: "1.0", events: [], operations: {} });

/** Append immutable evidence once; failure propagates to the managed caller. */
function appendHistory(root, event) {
  const normalized = { ...event, project_id: validateProjectId(event.project_id), ticket_id: validateProjectId(event.ticket_id) };
  const id = digest(normalized);
  return updateJsonLocked(historyPath(root), emptyHistory(), state => {
    if (!state.events.some(item => item.event_id === id)) state.events.push({ ...normalized, event_id: id });
    return state;
  });
}

/** Persist an intent before managed effects; unfinished intents are never labeled successful. */
function beginOperation(root, command, action, subject) {
  const id = crypto.randomUUID();
  updateJsonLocked(historyPath(root), emptyHistory(), state => {
    state.operations[id] = { command, action, subject, status: "STARTED", started_at: new Date().toISOString() };
    return state;
  });
  return id;
}

function finishOperation(root, id, error = null) {
  updateJsonLocked(historyPath(root), emptyHistory(), state => {
    if (!state.operations[id]) throw new Error("History intent is missing");
    Object.assign(state.operations[id], { status: error ? "FAILED" : "SUCCEEDED", finished_at: new Date().toISOString(),
      error: error ? "Managed command failed; inspect its execution record" : null });
    return state;
  });
}

/** Rebuild evidence from durable source state after crashes; no inferred historic approvals. */
function collectHistory(root, { includeSaved = true } = {}) {
  const local = path.join(root, ".harness", "local");
  const events = includeSaved ? [...readJson(historyPath(root), emptyHistory()).events] : [];
  const plans = readJsonDirectory(path.join(local, "requests"));
  const states = readJsonDirectory(path.join(local, "executions"));
  const registry = readJson(path.join(local, "projects.json"), { projects: {} });
  const outbox = readJson(path.join(local, "atlassian", "outbox.json"), { entries: [] });
  for (const plan of plans) for (const ticket of plan.tickets || []) {
    const state = states.find(item => item.request_id === plan.request_id);
    const execution = state?.tickets?.find(item => item.ticket_id === ticket.ticket_id);
    const shared = { project_id: ticket.project_id, ticket_id: ticket.ticket_id, request_id: plan.request_id,
      priority: ticket.priority || "P2", title: ticket.goal, technologies: registry.projects[ticket.project_id]?.stacks || [],
      source: path.join(local, "requests", `${plan.request_id}.json`),
      remote_records: outbox.entries.filter(e => e.project_id === ticket.project_id &&
        (e.request_id === plan.request_id && e.ticket_id === ticket.ticket_id || e.service === "jira" && e.remote_id && e.remote_id === ticket.source?.issue_id))
        .map(e => ({ service: e.service, status: e.status, remote_id: e.remote_id || null, event_id: e.id })) };
    events.push({ ...shared, kind: "TICKET", status: execution?.status || plan.status,
      timestamp: state?.updated_at || plan.approved_at || plan.generated_at,
      fingerprint: execution?.verification?.content_fingerprint || plan.content_fingerprint,
      error: execution?.error || null, verification: execution?.verification || null, jira: ticket.source || null });
    for (const attempt of execution?.runner?.history || []) events.push({ ...shared, kind: "ATTEMPT",
      status: attempt.status, timestamp: attempt.finished_at || attempt.started_at, attempt: attempt.attempt, error: attempt.error || null });
    for (const release of execution?.release_history || []) events.push({ ...shared, kind: "RELEASE", status: "APPLIED",
      timestamp: release.applied_at || release.recorded_at, release });
  }
  const roots = new Map([["harness", root], ...Object.entries(registry.projects).map(([id, p]) => [id, p.path])]);
  for (const [projectId, projectRoot] of roots) {
    if (!fs.existsSync(projectRoot)) continue;
    for (const status of ["backlog", "active", "blocked", "archive"]) {
      const dir = path.join(projectRoot, ".harness", "tasks", status);
      if (!fs.existsSync(dir)) continue;
      const realRoot = fs.realpathSync(projectRoot);
      const rel = path.relative(realRoot, fs.realpathSync(dir));
      if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Legacy ticket directory escaped project");
      for (const name of fs.readdirSync(dir).filter(n => n.endsWith(".md"))) {
        const file = path.join(dir, name);
        if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 256 * 1024) continue;
        const ticketId = name.slice(0, -3);
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(ticketId)) continue;
        const content = fs.readFileSync(file, "utf8");
        events.push({ project_id: projectId, ticket_id: ticketId, request_id: "legacy", kind: "LEGACY_TICKET",
          status: status.toUpperCase(), priority: null, title: content.match(/## Goal\s*\r?\n-?\s*([^\r\n]+)/)?.[1] || ticketId,
          timestamp: fs.statSync(file).mtime.toISOString(), timestamp_basis: "file-mtime-not-completion", source: file,
          technologies: registry.projects[projectId]?.stacks || [], verification: "unknown" });
      }
    }
  }
  return [...new Map(events.map(event => [event.event_id || digest(event), { ...event, event_id: event.event_id || digest(event) }])).values()];
}

function filterHistory(events, options = {}) {
  const time = value => {
    const n = Date.parse(value);
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z)?$/.test(value)
      || !Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== value.slice(0, 10)) throw new Error("Invalid history date; use UTC ISO or YYYY-MM-DD");
    return n;
  };
  const from = options.from ? time(options.from) : -Infinity,
    to = options.to ? time(options.to) + (options.to.length === 10 ? 86400000 - 1 : 0) : Infinity;
  if (from > to) throw new Error("History from must not exceed to");
  const terms = String(options.query || "").toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return events.filter(item => (!options.project || item.project_id === options.project)
    && (!options.ticket || item.ticket_id === options.ticket) && (!options.request || item.request_id === options.request)
    && (!options.status || item.status === options.status) && (!options.priority || item.priority === options.priority)
    && (!options.kind || item.kind === options.kind)
    && (!options.technology || item.technologies?.some(t => t.toLowerCase() === options.technology.toLowerCase()))
    && (!options.from && !options.to || (Number.isFinite(Date.parse(item.timestamp)) && Date.parse(item.timestamp) >= from && Date.parse(item.timestamp) <= to))
    && terms.every(term => JSON.stringify(item).toLocaleLowerCase().includes(term)))
    .sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")));
}

function refreshHistory(root) {
  const events = collectHistory(root, { includeSaved: false });
  return updateJsonLocked(historyPath(root), emptyHistory(), state => ({ ...state,
    events: [...new Map([...state.events, ...events].map(event => [event.event_id, event])).values()] }));
}

function withHistory(root, command, handler) {
  return async args => {
    const [action, subject] = args;
    const id = beginOperation(root, command, action || null, subject?.startsWith("--") ? null : subject || null);
    try {
      const result = await handler(args);
      refreshHistory(root);
      finishOperation(root, id);
      return result;
    } catch (error) {
      finishOperation(root, id, error);
      throw error;
    } finally {
      safeCaptureFollowups(root, message => process.stderr.write(`${message}\n`));
    }
  };
}

function createHistoryCommand({ root, parseArgs, log, reviewFingerprint }) {
  return args => {
    const { positional: [action], options } = parseArgs(args);
    if (action === "review") {
      if (![options.project, options.request, options.ticket].every(value => typeof value === "string" && value)) throw new Error("Review requires project, request and ticket");
      const events = filterHistory(collectHistory(root, { includeSaved: false }), { project: options.project, request: options.request, ticket: options.ticket, kind: "TICKET" });
      if (events.length !== 1 || events[0].status !== "REVIEW_READY" || !options.fingerprint || options.fingerprint !== events[0].fingerprint) {
        throw new Error("Review requires one REVIEW_READY ticket and its current fingerprint");
      }
      const state = readJson(path.join(root, ".harness", "local", "executions", `${validateProjectId(options.request)}.json`), null);
      const ticket = state?.tickets?.find(item => item.ticket_id === options.ticket && item.project_id === options.project);
      if (!reviewFingerprint || !ticket || reviewFingerprint(ticket.worktree) !== options.fingerprint) throw new Error("Review content changed; verify again");
      if (!["accepted", "changes-requested"].includes(options.result) || typeof options.reason !== "string") throw new Error("Review requires --result accepted|changes-requested and --reason");
      const event = { ...events[0], kind: "USER_REVIEW", status: options.result, reason: options.reason,
        timestamp: new Date().toISOString() };
      delete event.event_id;
      appendHistory(root, event); safeCaptureFollowups(root, log); log(JSON.stringify(event, null, 2)); return event;
    }
    if (action === "refresh") {
      const { events } = refreshHistory(root);
      log(`Recorded ${events.length} history events`); return events;
    }
    if (action === "status") { const state = readJson(historyPath(root), emptyHistory()); log(JSON.stringify(state.operations, null, 2)); return state.operations; }
    if (!["list", "search", "export"].includes(action)) throw new Error("Usage: history <list|search|export|refresh|review|status> [--project id] [--request id] [--ticket id] [--status value] [--query text] [--from ISO --to ISO]");
    const result = filterHistory(collectHistory(root, { includeSaved: action !== "list" }), options);
    log(JSON.stringify(result, null, 2)); return result;
  };
}

module.exports = { appendHistory, beginOperation, collectHistory, createHistoryCommand, filterHistory, finishOperation, refreshHistory, withHistory };
