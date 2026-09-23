"use strict";
const path = require("node:path");
const { writeJsonAtomic } = require("./control-plane-state");
const { validateProjectId } = require("./project-registry");

async function searchRemote(config, projectId, query, send, filters = {}) {
  validateProjectId(projectId);
  if (typeof query !== "string" || !query.trim() || query.length > 200) throw new Error("Provide a nonempty search query up to 200 characters");
  const quoted = JSON.stringify(query);
  const date = value => {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value))
      || new Date(value).toISOString().slice(0, 10) !== value) throw new Error("Remote date filters require valid YYYY-MM-DD");
    return value;
  };
  const from = filters.from ? date(filters.from) : null, to = filters.to ? date(filters.to) : null;
  if (from && to && from > to) throw new Error("Remote date from exceeds to");
  const endExclusive = to ? new Date(Date.parse(to) + 86400000).toISOString().slice(0, 10) : null;
  const jiraStatus = filters["jira-status"];
  if (jiraStatus !== undefined && (typeof jiraStatus !== "string" || !jiraStatus.trim() || jiraStatus.length > 100)) throw new Error("Invalid Jira status filter");
  const priority = filters["jira-priority"];
  const priorityIds = priority ? Object.entries(config.priority_map || {}).filter(([, value]) => value === priority).map(([id]) => id) : [];
  if (priority && (!["P0", "P1", "P2", "P3"].includes(priority) || !priorityIds.length || priorityIds.some(id => !/^[0-9]+$/.test(id)))) throw new Error("Jira priority filter requires mapped numeric IDs");
  const output = { project_id: projectId, jira: null, confluence: null };
  for (const service of ["jira", "confluence"]) {
    const key = service === "jira" ? config.jira_projects[projectId] : config.confluence_projects?.[projectId]?.space_key;
    if (!/^[a-z0-9_~-]+$/i.test(key || "")) { output[service] = { status: "not-configured", results: [] }; continue; }
    const results = [], seen = new Set();
    let cursor = null, complete = false;
    try {
      for (let page = 0; page < 10; page++) {
        const url = new URL(service === "jira" ? "/rest/api/3/search/jql" : "/rest/api/search", config.site);
        const timeField = service === "jira" ? "updated" : "lastmodified";
        const timeFilter = (from ? ` AND ${timeField} >= ${JSON.stringify(from)}` : "")
          + (endExclusive ? ` AND ${timeField} < ${JSON.stringify(endExclusive)}` : "");
        if (service === "jira") {
          url.searchParams.set("jql", `project = ${JSON.stringify(key)} AND text ~ ${quoted}${timeFilter}`
            + (jiraStatus ? ` AND status = ${JSON.stringify(jiraStatus)}` : "")
            + (priority ? ` AND priority in (${priorityIds.join(",")})` : "") + " ORDER BY key");
          url.searchParams.set("fields", "summary,project,status,priority"); url.searchParams.set("maxResults", "25");
        } else {
          url.searchParams.set("cql", `type = page AND space = ${JSON.stringify(key)} AND text ~ ${quoted}${timeFilter}`);
          url.searchParams.set("expand", "content.space"); url.searchParams.set("limit", "25");
        }
        if (cursor) url.searchParams.set(service === "jira" ? "nextPageToken" : "cursor", cursor);
        const body = await send(config, service, url.pathname + url.search);
        const items = service === "jira" ? body.issues : body.results;
        if (!Array.isArray(items)) throw new Error("Invalid search response");
        for (const item of items) {
          if (service === "jira") {
            if (item.fields?.project?.key !== key || !/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/.test(item.key)) throw new Error("Search project mismatch");
            results.push({ id: item.id, title: item.fields.summary, status: item.fields.status?.name, priority: item.fields.priority?.name,
              url: `${config.site}/browse/${item.key}` });
          } else {
            if (item.content?.space?.key !== key || !/^[0-9]+$/.test(item.content?.id || "")) throw new Error("Search space mismatch");
            results.push({ id: item.content.id, title: item.title, url: `${config.site}/wiki/pages/viewpage.action?pageId=${item.content.id}` });
          }
        }
        if (service === "jira") {
          if (body.isLast === true) { complete = true; break; }
          cursor = body.nextPageToken;
        } else {
          if (!body._links?.next) { complete = true; break; }
          // Never follow a remote pagination URL: extract only an opaque cursor onto the fixed endpoint.
          cursor = new URL(body._links.next, config.site).searchParams.get("cursor");
        }
        if (typeof cursor !== "string" || !cursor || cursor.length > 8192 || seen.has(cursor)) throw new Error("Invalid search cursor");
        seen.add(cursor);
      }
      output[service] = { status: complete ? "available" : "truncated", results };
    } catch { output[service] = { status: "unavailable", reason: "Remote search failed or response mismatched; results are incomplete", results }; }
  }
  return output;
}

async function fetchProjectPages(root, config, projectId, send, now) {
  validateProjectId(projectId);
  const settings = config.confluence_projects?.[projectId];
  const ids = settings?.context_page_ids;
  if (!/^[0-9]+$/.test(settings?.space_id || "") || !Array.isArray(ids) || !ids.length || ids.length > 10
    || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || !/^[0-9]+$/.test(id))) throw new Error("Configure 1-10 unique context_page_ids and space_id");
  const pages = [];
  for (const id of ids) {
    const page = await send(config, "confluence", `/api/v2/pages/${id}?body-format=storage`);
    if (page.id !== id || page.spaceId !== settings.space_id || !Number.isInteger(page.version?.number)
      || typeof page.body?.storage?.value !== "string") throw new Error("Context page identity, space or version mismatch");
    pages.push({ id, version: page.version.number, title: String(page.title || "").slice(0, 500),
      content: page.body.storage.value, url: `${config.site}/wiki/pages/viewpage.action?pageId=${id}` });
  }
  const snapshot = { project_id: projectId, site: config.site, cloud_id: config.cloud_id || null, space_id: settings.space_id,
    fetched_at: new Date(now()).toISOString(), trust: "untrusted-project-input", pages };
  writeJsonAtomic(path.join(root, ".harness", "local", "remote-context", `${projectId}.json`), snapshot);
  return snapshot;
}
module.exports = { searchRemote, fetchProjectPages };
