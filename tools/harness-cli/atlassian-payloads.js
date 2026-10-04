"use strict";

const crypto = require("node:crypto");
const { normalizeReadableLabels } = require("./jira-labels");
const { KIND_LABELS, normalizeTicketKind } = require("./ticket-artifacts");
const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const html = text => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** One canonical payload for preview, manual publication and standing-consent validation. */
function ticketDraft(config, plan, ticket, requestId = plan.request_id) {
  if (!ticket || plan.status !== "DRAFT" || ticket.source) throw new Error("Publish only an unlinked DRAFT ticket; Jira is not an execution approval");
  const projectKey = config.jira_projects[ticket.project_id], issueType = config.jira_issue_types?.[ticket.project_id];
  if (!/^[A-Z][A-Z0-9_]*$/.test(projectKey || "") || !/^[0-9]+$/.test(issueType || "")) throw new Error("Configure jira_projects and jira_issue_types for this project");
  const priorities = Object.entries(config.priority_map || {}).filter(([, value]) => value === ticket.priority).map(([id]) => id);
  if (priorities.length > 1) throw new Error("Choose a unique Jira priority id for this local priority before publishing");
  const kind = normalizeTicketKind(ticket.ticket_kind);
  const labels = normalizeReadableLabels(ticket.labels);
  const input = { ticket_kind: kind, deliverables: ticket.deliverables || [], request_id: requestId, ticket_id: ticket.ticket_id, projectKey, issueType, ticket_snapshot: hash(ticket),
    ...(labels.length ? { labels } : {}), context_refs: ticket.context_refs || [], goal: ticket.goal, scope: ticket.scope, exclusions: ticket.exclusions, acceptance_criteria: ticket.acceptance_criteria,
    implementation_steps: ticket.implementation_steps, test_plan: ticket.test_plan, verification: ticket.verification };
  return { input, build: marker => ({ fields: { project: { key: projectKey }, issuetype: { id: issueType },
    ...(priorities.length ? { priority: { id: priorities[0] } } : {}), summary: `${kind === "development" ? "" : `[${KIND_LABELS[kind]}] `}${ticket.goal}`.slice(0, 255), labels: [...new Set([marker, `harness-kind-${kind}`, KIND_LABELS[kind].replace(/\s+/g, ""), ...labels])],
    description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: JSON.stringify(input, null, 2) }] }] }
  } }) };
}

function resultPayload(destination, input, marker) {
  return { spaceId: destination.space_id, parentId: destination.parent_id, status: "current", title: input.title,
    body: { representation: "storage", value: `<p>${marker}</p><p>${html(input.request_id)} / ${html(input.ticket_id)}</p><pre>${html(input.summary)}</pre>` } };
}

module.exports = { ticketDraft, resultPayload };
