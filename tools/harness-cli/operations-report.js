"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { readJson } = require("./control-plane-state");
const { validateProjectId } = require("./project-registry");
const { assertArtifactEvidence, isArtifactTicket } = require("./ticket-artifacts");

const TIME_FIELDS = ["requirements", "setup", "review", "recovery"];
const REPORT_ACTIONS = new Set(["report", "measure", "map-check", "audit-tasks"]);

function minutes(value, name) {
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value))) throw new Error(`Invalid ${name}; use non-negative measured minutes`);
  return Number(value);
}

/** Missing observations stay unknown; self-reported time is never an automatic productivity claim. */
function summarizeMeasurement(measurement) {
  const values = TIME_FIELDS.map(field => measurement?.[`${field}_minutes`] ?? null);
  const total = values.every(value => typeof value === "number" && Number.isFinite(value) && value >= 0) ? values.reduce((sum, value) => sum + value, 0) : null;
  const baseline = measurement?.baseline_minutes;
  return { human_minutes: total, baseline_minutes: baseline ?? null,
    reduction_percent: total !== null && Number.isFinite(baseline) && baseline > 0 ? Number(((1 - total / baseline) * 100).toFixed(2)) : null,
    basis: "self-reported; matched task scope required; not causal proof" };
}

function scopedTicket(root, options) {
  const ids = Object.fromEntries(["project", "request", "ticket"].map(key => [key, validateProjectId(options[key])]));
  const local = path.join(root, ".harness/local");
  const plan = readJson(path.join(local, "requests", `${ids.request}.json`), null);
  const state = readJson(path.join(local, "executions", `${ids.request}.json`), null);
  const planned = plan?.tickets?.find(ticket => ticket.ticket_id === ids.ticket && ticket.project_id === ids.project);
  const executed = state?.tickets?.find(ticket => ticket.ticket_id === ids.ticket && ticket.project_id === ids.project);
  if (!planned || !executed) throw new Error("Unknown scoped ticket or execution");
  return { ...ids, planned, executed, plan_current: typeof plan.content_fingerprint === "string" && plan.content_fingerprint.length > 0 && state.request_fingerprint === plan.content_fingerprint };
}

function duration(start, end) {
  const from = Date.parse(start), to = Date.parse(end);
  return Number.isFinite(from) && Number.isFinite(to) && to >= from ? to - from : null;
}

/** Review aids only: mapping a passed command to a criterion does not prove its semantic coverage. */
function ticketReport(root, subject, events, reviewFingerprint) {
  const { planned, executed } = subject;
  const fingerprint = executed.verification?.content_fingerprint || null;
  let current = null;
  if (fingerprint && executed.worktree && reviewFingerprint) {
    try { current = reviewFingerprint(executed.worktree) === fingerprint; if (current && isArtifactTicket(executed)) assertArtifactEvidence(executed); } catch { current = false; }
  }
  const sameTicket = event => event.project_id === subject.project && event.request_id === subject.request && event.ticket_id === subject.ticket;
  const scoped = events.filter(sameTicket);
  const reviewed = executed.verification?.reviewed_content_fingerprint;
  const scopedCurrent = scoped.filter(event => event.fingerprint === fingerprint || reviewed && event.fingerprint === reviewed);
  const measurement = scoped.filter(event => event.kind === "AX_MEASUREMENT").at(-1) || null;
  const history = executed.runner?.history || [];
  const usage = readJson(path.join(root, "observability/provider-usage/usage.json"), { months: {} });
  const key = `${subject.project}:${subject.request}:${subject.ticket}`;
  const samples = Object.values(usage.months || {}).flatMap(month => month.tickets?.[key] ? [month.tickets[key]] : []);
  const tokens = samples.length && samples.every(sample => sample.complete === true) ? samples.reduce((sum, sample) => sum + sample.total_tokens, 0) : null;
  const results = executed.verification?.results || [];
  return { project_id: subject.project, request_id: subject.request, ticket_id: subject.ticket, status: executed.status,
    plan_binding_current: subject.plan_current, content_current: current, content_fingerprint: fingerprint,
    attempts: executed.runner?.attempts ?? null, failed_attempts: history.filter(item => item.status === "FAILED").length,
    runner_elapsed_ms: duration(executed.runner?.started_at, executed.runner?.completed_at || executed.runner?.failed_at),
    verification_ms: results.length && results.every(result => Number.isFinite(result.duration_ms) && result.duration_ms >= 0)
      ? results.reduce((sum, result) => sum + result.duration_ms, 0) : null,
    observed_api_tokens: tokens, attributed_api_responses: samples.reduce((sum, sample) => sum + sample.responses, 0),
    estimated_input_tokens: executed.runner?.estimated_input_tokens ?? null, estimated_output_tokens: executed.runner?.estimated_output_tokens ?? null,
    usage_boundary: "Attributed responses only; excludes host chat, failed responses without usage, account balance and subscriptions",
    human_measurement: measurement ? { ...summarizeMeasurement(measurement), note: measurement.note, measured_at: measurement.timestamp } : summarizeMeasurement(null),
    ticket_kind: planned.ticket_kind || "development", artifacts: executed.verification?.artifacts || [],
    verification_mode: executed.verification?.mode || "commands",
    acceptance: (planned.acceptance_criteria || []).map((criterion, index) => {
      const mapping = scopedCurrent.filter(event => event.kind === "ACCEPTANCE_EVIDENCE" && event.criterion_index === index + 1).at(-1);
      const result = mapping && results[mapping.command_index - 1];
      const valid = current === true && subject.plan_current && mapping && result?.command === mapping.command && result.status === 0;
      return { index: index + 1, criterion, evidence_status: executed.verification?.mode === "artifact" ? (current === true && subject.plan_current ? "artifact-structure-checked; human-review-required" : "unmapped-or-stale") : valid ? "mapped-command-passed; human-review-required" : "unmapped-or-stale",
        command: mapping?.command || null, note: mapping?.note || null };
    }), test_plan: planned.test_plan || {}, verification_results: results,
    review: current === true && subject.plan_current ? scopedCurrent.filter(event => event.kind === "USER_REVIEW").at(-1)?.status || null : null,
    notice: "No automatic acceptance, release approval, semantic correctness or 95% savings claim" };
}

function auditTasks(root) {
  const tasks = [];
  for (const state of ["backlog", "active", "blocked", "archive"]) {
    const directory = path.join(root, ".harness/tasks", state);
    if (!fs.existsSync(directory)) continue;
    const realRoot = fs.realpathSync(root), rel = path.relative(realRoot, fs.realpathSync(directory));
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Task directory escapes root");
    for (const name of fs.readdirSync(directory).filter(name => /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(name))) {
      const file = path.join(directory, name);
      if (fs.lstatSync(file).isSymbolicLink() || fs.statSync(file).size > 256 * 1024) continue;
      const content = fs.readFileSync(file, "utf8");
      const section = content.match(/^## Acceptance(?: Criteria)?\s*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1] || "";
      const pending = (section.match(/^- \[ \]/gm) || []).length, checked = (section.match(/^- \[x\]/gim) || []).length;
      tasks.push({ ticket_id: name.slice(0, -3), state, checked, pending,
        disposition: state === "archive" ? "recorded-archive; not-reverified" : pending > 0 || checked === 0 ? "criteria-review-required" : "implementation-checked; completion-review-required" });
    }
  }
  return { tasks, notice: "Read-only audit; no automatic archive, inferred approval or historical re-verification" };
}

function createOperationsReportCommand({ root, appendHistory, collectHistory, reviewFingerprint, now = () => new Date().toISOString() }) {
  return (action, options) => {
    if (action === "audit-tasks") return auditTasks(root);
    const subject = scopedTicket(root, options);
    const events = collectHistory(root);
    if (action === "report") return ticketReport(root, subject, events, reviewFingerprint);
    const base = { project_id: subject.project, request_id: subject.request, ticket_id: subject.ticket,
      fingerprint: subject.executed.verification?.content_fingerprint || null, timestamp: now() };
    if (typeof options.note !== "string" || !options.note.trim() || options.note.length > 2000) throw new Error("Provide a measured/evidence --note (1-2000 characters); never include secrets");
    let event;
    if (action === "measure") {
      event = { ...base, kind: "AX_MEASUREMENT", note: options.note, baseline_minutes: minutes(options["baseline-minutes"], "baseline") };
      for (const field of TIME_FIELDS) event[`${field}_minutes`] = minutes(options[`${field}-minutes`], field);
      if (event.baseline_minutes === 0) throw new Error("Baseline must be positive or omitted");
    } else if (action === "map-check") {
      const criterion = Number(options.criterion), commandIndex = Number(options["command-index"]);
      const result = subject.executed.verification?.results?.[commandIndex - 1];
      if (!Number.isInteger(criterion) || criterion < 1 || criterion > (subject.planned.acceptance_criteria || []).length
        || !Number.isInteger(commandIndex) || commandIndex < 1 || result?.status !== 0 || !result.command) throw new Error("Choose an existing criterion and a passed verification command (1-based indices)");
      if (!subject.plan_current || subject.executed.status !== "REVIEW_READY" || !base.fingerprint || !reviewFingerprint
        || reviewFingerprint(subject.executed.worktree) !== base.fingerprint) throw new Error("Current REVIEW_READY verification required before mapping evidence");
      event = { ...base, kind: "ACCEPTANCE_EVIDENCE", criterion_index: criterion, command_index: commandIndex, command: result.command, note: options.note };
    } else throw new Error("Unknown report action");
    appendHistory(root, event);
    return event;
  };
}

module.exports = { REPORT_ACTIONS, auditTasks, createOperationsReportCommand, scopedTicket, summarizeMeasurement, ticketReport };
