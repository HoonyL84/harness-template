"use strict";

const { isDeepStrictEqual } = require("node:util");
const numeric = value => typeof value === "string" && /^[0-9]+$/.test(value);
const category = value => ["new", "indeterminate", "done"].includes(value);

/** Only the exact single-text ADF emitted by ticketDraft is eligible for JSON comparison. */
function ticketDescriptionJson(description) {
  if (!description || description.type !== "doc" || description.version !== 1 || Object.keys(description).some(k => !["type", "version", "content"].includes(k))
      || description.content?.length !== 1) return undefined;
  const paragraph = description.content[0], text = paragraph?.content?.[0];
  if (paragraph?.type !== "paragraph" || Object.keys(paragraph).some(k => !["type", "content"].includes(k)) || paragraph.content.length !== 1
      || text?.type !== "text" || typeof text.text !== "string" || Object.keys(text).some(k => !["type", "text"].includes(k))) return undefined;
  try { const parsed = JSON.parse(text.text); return parsed && !Array.isArray(parsed) && typeof parsed === "object" ? parsed : undefined; }
  catch { return undefined; }
}

function publishedDescriptionMatches(actual, expected) {
  if (isDeepStrictEqual(actual, expected)) return true;
  const object = ticketDescriptionJson(expected);
  if (!object || typeof actual !== "string") return false;
  const value = actual.trim(), fence = /^```(?:json)?\r?\n([\s\S]*?)\r?\n```$/.exec(value);
  try { return isDeepStrictEqual(JSON.parse(fence ? fence[1] : value), object); }
  catch { return false; }
}

function unwrap(raw) {
  const data = raw?.data;
  if (!data || typeof data !== "object" || data.error === true || data.ok === false) throw new Error("Invalid Atlassian MCP data envelope");
  return data;
}

function statuses(data) {
  if (!Array.isArray(data.statuses) || !data.statuses.length) throw new Error("Missing project status evidence");
  const values = data.statuses.map(s => {
    if (!numeric(s.id) || typeof s.name !== "string" || !category(s.category)) throw new Error("Invalid status identity/category");
    return { id: s.id, name: s.name, statusCategory: { key: s.category } };
  });
  if (new Set(values.map(s => s.id)).size !== values.length) throw new Error("Duplicate status identity");
  return values;
}

/** Normalize only observed official v2 envelopes, never synthesize missing destination evidence. */
async function normalizeResponse({ raw, mapped, tool, input, read }) {
  if (!raw?.data) return mapped;
  const data = unwrap(raw);
  if (tool === "createConfluenceContent" && input.operation === "confluence.createPage") {
    const page = data.content;
    if (data.ok !== true || data.contentType !== "page" || !numeric(page?.id) || page.spaceId !== input.payload.spaceId
        || page.parentId !== input.payload.parentId || page.title !== input.payload.title || page.type !== "page") {
      throw new Error("Confluence creation destination/acknowledgement mismatch");
    }
    return page;
  }
  if (tool === "getConfluenceContent" && input.operation === "confluence.getPage") {
    if (data.id !== input.id || !numeric(data.spaceId) || data.type !== "page" || data.status !== "current"
        || data.body?.format !== "html" || typeof data.body.value !== "string" || !Number.isInteger(data.metadata?.version?.number)
        || data.metadata.version.number < 1) throw new Error("Confluence content identity/version/body mismatch");
    const ancestors = unwrap(await read("getConfluenceContentAncestors", { cloudId: input.cloudId, contentId: data.id, limit: 250 }));
    if (!Array.isArray(ancestors.results) || ancestors.results.some(a => !numeric(a.id) || a.id === data.id)
        || new Set(ancestors.results.map(a => a.id)).size !== ancestors.results.length || ancestors._links?.next) throw new Error("Invalid ancestor evidence");
    // Atlassian ancestors are top-to-bottom: the last entry is the immediate parent.
    return { id: data.id, title: data.title, status: data.status, spaceId: data.spaceId,
      parentId: ancestors.results.at(-1)?.id || null, version: data.metadata.version, body: { storage: { value: data.body.value } } };
  }
  if (tool === "listJiraIssueTransitions" && input.operation === "jira.listTransitions") {
    if (!Array.isArray(data.transitions)) throw new Error("Invalid transitions response");
    if (data.transitions.every(t => numeric(t.to?.id))) return data;
    const issue = unwrap(await read("getJiraIssue", { cloudId: input.cloudId, issueIdOrKey: input.id, view: "full" }));
    if (!(issue.id === input.id || issue.key === input.id) || !/^[A-Z][A-Z0-9_]*$/.test(issue.fields?.project?.key || "")
        || !numeric(issue.fields?.issuetype?.id)) throw new Error("Transition issue identity/type mismatch");
    const list = unwrap(await read("listJiraStatuses", { cloudId: input.cloudId, mode: "project",
      projectKey: issue.fields.project.key, issueType: issue.fields.issuetype.id }));
    const types = list.workTypes?.filter(t => t.id === issue.fields.issuetype.id);
    if (types?.length !== 1 || !Array.isArray(types[0].statusIds)) throw new Error("Missing work-type status evidence");
    const available = statuses(list).filter(s => types[0].statusIds.includes(s.id));
    return { ...data, transitions: data.transitions.map(t => {
      const matches = available.filter(s => s.name === t.to?.name && s.statusCategory.key === t.to?.statusCategory?.key
        && (!t.to?.id || s.id === t.to.id));
      if (!numeric(t.id) || matches.length !== 1) throw new Error("Ambiguous or missing transition destination");
      return { ...t, to: { ...t.to, ...matches[0] } };
    }) };
  }
  if (tool === "listJiraStatuses" && input.operation === "jira.projectStatuses") {
    const available = statuses(data);
    if (data.mode !== "project" || !Array.isArray(data.workTypes) || !data.workTypes.length
      || new Set(available.map(s => s.id)).size !== available.length
      || new Set(data.workTypes.map(t => t.id)).size !== data.workTypes.length) throw new Error("Invalid project workflow status evidence");
    return data.workTypes.map(type => {
      if (!numeric(type.id) || !Array.isArray(type.statusIds) || !type.statusIds.length
        || new Set(type.statusIds).size !== type.statusIds.length || type.statusIds.some(id => !available.some(s => s.id === id))) throw new Error("Work type references unknown or duplicate status");
      return { id: type.id, name: type.name || type.id, statuses: available.filter(s => type.statusIds.includes(s.id)) };
    });
  }
  if (tool === "listJiraStatuses" && input.operation === "jira.getStatus") {
    const matches = statuses(data).filter(s => s.id === input.id);
    if (matches.length !== 1) throw new Error("Status lookup identity mismatch");
    return matches[0];
  }
  return mapped;
}

module.exports = { ticketDescriptionJson, publishedDescriptionMatches, normalizeResponse };
