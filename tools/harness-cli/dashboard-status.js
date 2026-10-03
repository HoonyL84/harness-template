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
function overviewLines(o) {
  return ["Projects: " + (o.projects.map(p => p.project_id + "=" + p.git_state).join(", ") || "none"),
    "Local tickets: " + ["active", "review", "blocked", "backlog"].map(s => s + "=" + o.tasks.filter(t => t.state === s).length).join(" "),
    "Observed tokens (" + o.usage.month + "): " + o.usage.providers.map(p => p.provider + "=" + p.observed_tokens + " remaining=" + (p.remaining_tokens ?? "unknown") + (p.estimated_cost ? " estimate_USD=" + (p.estimated_cost.usd ?? "unknown") : "")).join("; "),
    "Connections: " + Object.entries(o.connections).map(([k, v]) => k + "=" + v.status).join(", "), o.notice];
}
module.exports = { dashboardOverview, overviewLines };
