"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { readRegistry } = require("./project-registry");
const { readJson } = require("./control-plane-state");
const { auditTasks } = require("./operations-report");
const { createProviderUsageService } = require("./provider-usage");
const configured = v => typeof v === "string" && !!v.trim() && !/your_|replace|placeholder|example|your\/webhook/i.test(v);
/** Local snapshot by default. Explicit probes are read-only and never return credentials. */
async function dashboardOverview({ root, runGit, env, fetchImpl, options, checkAtlassian }) {
  const projects = Object.entries(readRegistry(path.join(root, ".harness/local/projects.json")).projects).map(([project_id, project]) => {
    let git_state = "unknown", changed_entries = null;
    try {
      if (typeof project.path === "string" && fs.statSync(project.path).isDirectory()) {
        const result = runGit(["status", "--porcelain=v1", "-z", "--untracked-files=all"], project.path);
        if (!result.error && result.status === 0 && typeof result.stdout === "string") {
          git_state = result.stdout ? "dirty" : "clean";
          // Rename entries contain two NUL fields; count only status-prefixed fields.
          changed_entries = result.stdout.split("\0").filter(field => /^[ MADRCU?!]{2} /.test(field)).length;
        }
      }
    } catch { /* Missing/unreadable projects are unknown, never clean. */ }
    return { project_id, git_state, changed_entries };
  });
  const usage = createProviderUsageService({ root, env, isPlaceholder: v => !configured(v) }).status({ cost: Boolean(options.cost) });
  const providers = usage.providers.map(p => ({ provider: p.provider, active: p.active, configured: p.configured,
    observed_tokens: p.observed_usage.total_tokens, monthly_token_budget: p.monthly_token_budget, remaining_tokens: p.remaining_tokens,
    ...(options.cost ? { estimated_cost: p.estimated_cost } : {}) }));
  let jiraConfigured = false, jiraStatus = "not-configured";
  try { jiraConfigured = !!readJson(path.join(root, ".harness/local/atlassian.json"), null)?.site; jiraStatus = jiraConfigured ? "not-checked" : "not-configured"; }
  catch { jiraStatus = "invalid-config"; }
  const connections = {
    atlassian: { configured: jiraConfigured, status: jiraStatus },
    telegram: { configured: configured(env.TELEGRAM_BOT_TOKEN) && configured(env.TELEGRAM_CHAT_ID), status: "not-checked" },
    slack: { configured: configured(env.SLACK_WEBHOOK_URL), status: "not-checked" }
  };
  for (const connection of Object.values(connections)) if (!connection.configured && connection.status !== "invalid-config") connection.status = "not-configured";
  const offline = ["1", "true"].includes(env.HARNESS_OFFLINE);
  if (options["check-connections"] && !offline) {
    if (connections.atlassian.configured && checkAtlassian) {
      try { const report = await checkAtlassian(); connections.atlassian.status = [report.jira?.status, report.confluence?.status].every(status => status === "readable") ? "readable" : "partial-or-unavailable";
        connections.atlassian.jira = report.jira?.status || "unknown"; connections.atlassian.confluence = report.confluence?.status || "unknown";
        connections.atlassian.write_permissions = "not-tested";
      } catch { connections.atlassian.status = "unreachable-or-unauthorized"; }
    }
    if (connections.telegram.configured) {
      try {
        const response = await fetchImpl("https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/getMe", { method: "GET", redirect: "error", signal: globalThis.AbortSignal.timeout(10000) });
        const body = await response.json(); connections.telegram.status = response.ok && body.ok === true ? "authenticated-bot-only" : "unauthorized-or-api-error";
      } catch { connections.telegram.status = "unreachable"; }
    }
    if (connections.slack.configured) connections.slack.status = "not-supported-read-only";
  }
  return { projects, tasks: auditTasks(root).tasks, usage: { month: usage.month, providers }, connections,
    notice: "Local configuration is not connection health. Token budget is local, not account balance. Probes do not prove notification delivery or write permission.", offline };
}
function compactText(value, max = 90) {
  const single = String(value || "").replace(/\s+/g, " ").trim();
  if (!single) return "";
  return single.length > max ? `${single.slice(0, max - 1)}…` : single;
}

function localTicketLines(tasks = []) {
  return ["active", "blocked", "backlog", "review"]
    .flatMap(state => tasks.filter(t => t.state === state))
    .map(t => {
      const label = t.title && t.title !== t.ticket_id ? `${t.ticket_id} — ${compactText(t.title, 70)}` : t.ticket_id;
      return `  - [${t.state}] ${label}`;
    });
}

function ticketSummaryLine(ticket, planTicket = null) {
  const id = ticket.ticket_id || planTicket?.ticket_id || "unknown";
  const label = compactText(ticket.title || planTicket?.title || ticket.goal || planTicket?.goal, 60);
  const status = ticket.status ? `[${ticket.status}] ` : "";
  return `  - ${status}${id}${label && label !== id ? ` — ${label}` : ""}`;
}

function executionStatusLabel(state) {
  const tickets = state.tickets || [];
  if (tickets.some(t => t.status === "BLOCKED")) return "BLOCKED";
  if (state.status === "REVIEW_READY") return "REVIEW_READY";
  if (tickets.some(t => t.status === "REVIEW_READY" && !t.committed_sha)) return "PARTIAL_REVIEW_READY";
  if (tickets.some(t => t.status === "WAITING_DEPENDENCY")) return "WAITING_DEPENDENCY";
  return state.status;
}

function formatRequestBlock(request, next) {
  const status = request.status === "DRAFT" ? "PLAN_READY" : `PLAN_${request.status}`;
  const parts = [`${request.request_id}: ${status}`];
  const goal = compactText(request.goal);
  if (goal) parts.push(`Goal: ${goal}`);
  const tickets = request.tickets || [];
  if (tickets.length) {
    parts.push(`Tickets (${tickets.length}):`, ...tickets.map(ticket => ticketSummaryLine(ticket)));
  }
  if (next) parts.push(next);
  return parts.join("\n");
}

function formatExecutionBlock(state, request, next) {
  const status = executionStatusLabel(state);
  const tickets = state.tickets || [];
  const planById = new Map((request?.tickets || []).map(t => [t.ticket_id, t]));
  const parts = [`${state.request_id}: ${status}`];
  const goal = compactText(state.goal || request?.goal);
  if (goal) parts.push(`Goal: ${goal}`);
  if (tickets.length) {
    const done = tickets.filter(t => t.status === "COMPLETED").length;
    parts.push(`Progress: ${done}/${tickets.length} completed`);
    if (tickets.some(t => t.ticket_id)) {
      parts.push(...tickets.map(t => ticketSummaryLine(t, planById.get(t.ticket_id))));
    }
  }
  const blocked = tickets.filter(t => t.status === "BLOCKED");
  if (blocked.length) parts.push(`Evidence: ${blocked.map(t => `${t.ticket_id}=${t.error}`).join("; ")}`);
  else if (status === "PARTIAL_REVIEW_READY") parts.push(`Tickets: ${tickets.filter(t => t.status === "REVIEW_READY" && !t.committed_sha).map(t => t.ticket_id).join(", ")}`);
  else if (status === "WAITING_DEPENDENCY") parts.push(`Tickets: ${tickets.filter(t => t.status === "WAITING_DEPENDENCY").map(t => `${t.ticket_id} (${t.waiting_reason})`).join("; ")}`);
  if (next) parts.push(next);
  return parts.join("\n");
}

function overviewLines(o) {
  const ticketHeader = "Local tickets: " + ["active", "review", "blocked", "backlog"].map(s => s + "=" + o.tasks.filter(t => t.state === s).length).join(" ");
  return ["Projects: " + (o.projects.map(p => p.project_id + "=" + p.git_state).join(", ") || "none"),
    [ticketHeader, ...localTicketLines(o.tasks)].join("\n"),
    "Observed tokens (" + o.usage.month + "): " + o.usage.providers.map(p => p.provider + "=" + p.observed_tokens + " remaining=" + (p.remaining_tokens ?? "unknown") + (p.estimated_cost ? " estimate_USD=" + (p.estimated_cost.usd ?? "unknown") : "")).join("; "),
    "Connections: " + Object.entries(o.connections).map(([k, v]) => k + "=" + v.status).join(", "), o.notice];
}
module.exports = { dashboardOverview, executionStatusLabel, formatExecutionBlock, formatRequestBlock, overviewLines };
