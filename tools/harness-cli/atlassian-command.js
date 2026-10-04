"use strict";

const crypto = require("node:crypto");
const { recoveryAdvice } = require("./publication-recovery");
const fs = require("node:fs");
const path = require("node:path");
const { readJson, updateJsonLocked, withFileLock } = require("./control-plane-state");
const { readConnection, readBoundedJson, snapshot, requireJiraFresh } = require("./jira-input");
const { planFingerprint, validateRequestPlan } = require("./request-plan");
const { readIntent, bindFollowup, assertFollowup, summaryInput } = require("./operations-followup");
const { validateProjectId } = require("./project-registry");
const { searchRemote, fetchProjectPages } = require("./atlassian-read");
const { createConnectionCommand } = require("./atlassian-connection");
const { consentCommand, assertConsentedEntry } = require("./atlassian-consent");
const { ticketDraft, resultPayload } = require("./atlassian-payloads");
const { isArtifactTicket } = require("./ticket-artifacts");
const { createPriorityBatchCommand } = require("./atlassian-priority-batch");
const { publishedDescriptionMatches } = require("./atlassian-mcp-contracts");
const { transport, connectionIdentity, matchesConnection, createMcpClient } = require("./atlassian-mcp");

const hash = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const empty = () => ({ schema_version: "1.0", entries: [] });
const identity = connectionIdentity;

async function remote(config, service, endpoint, payload, { env, fetchImpl }) {
  if (["true", "1"].includes(env.HARNESS_OFFLINE)) throw new Error("Atlassian is unavailable offline");
  if (!env.ATLASSIAN_EMAIL || !env.ATLASSIAN_API_TOKEN) throw new Error("Atlassian credentials are missing");
  const base = config.cloud_id ? `https://api.atlassian.com/ex/${service}/${config.cloud_id}` : `${config.site}${service === "confluence" ? "/wiki" : ""}`;
  let response;
  try {
    response = await fetchImpl(base + endpoint, { method: payload ? "POST" : "GET", redirect: "error",
      signal: globalThis.AbortSignal.timeout(15000), headers: { Accept: "application/json", "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${env.ATLASSIAN_EMAIL}:${env.ATLASSIAN_API_TOKEN}`).toString("base64")}` },
      ...(payload ? { body: JSON.stringify(payload) } : {}) });
  } catch { throw new Error("Atlassian network result is unknown; reconcile before retrying a write"); }
  if (!response.ok) {
    await response.body?.cancel();
    throw Object.assign(new Error(`Atlassian HTTP ${response.status}`), { status: response.status });
  }
  if (response.status === 204) return {};
  return readBoundedJson(response);
}

function createAtlassianCommand({ root, parseArgs, log, env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now(), reviewFingerprint }) {
  const file = path.join(root, ".harness", "local", "atlassian", "outbox.json");
  const read = () => readJson(file, empty());
  const update = fn => updateJsonLocked(file, empty(), fn);
  const preview = state => state.entries.filter(e => e.status === "PENDING").map(e => ({ id: e.id, revision: e.revision || 0, connection: e.connection, service: e.service,
    operation: e.operation || "create", transition: e.transition || null, followup: e.followup || null, payload: e.payload }));
  const print = value => { log(JSON.stringify(value, null, 2)); return value; };
  const mcp = createMcpClient({ env, fetchImpl });
  const send = (config, service, endpoint, payload) => transport(config) === "mcp"
    ? mcp.send(config, service, endpoint, payload) : remote(config, service, endpoint, payload, { env, fetchImpl });

  const priorityBatch = createPriorityBatchCommand({ root, send, now, stats: mcp.stats });

  function enqueue(config, projectId, service, input, build) {
    const previousTicket = service === "jira" && !input.operation ? read().entries.find(e => e.service === "jira" && e.operation === "create"
      && e.project_id === projectId && e.request_id === input.request_id && e.ticket_id === input.ticket_id) : null;
    const id = previousTicket?.id || hash({ projectId, service, connection: identity(config), input: service === "jira" && !input.operation
      ? { request_id: input.request_id, ticket_id: input.ticket_id } : input });
    const marker = `harness-${id}`;
    const entry = { id, project_id: projectId, request_id: input.request_id, ticket_id: input.ticket_id, service, connection: identity(config), marker,
      operation: input.operation || "create", ...(input.transition ? { transition: input.transition } : {}),
      ...(input.followup ? { followup: input.followup } : {}), ...(input.ticket_snapshot ? { ticket_snapshot: input.ticket_snapshot } : {}),
      payload: build(marker), status: "PENDING", created_at: new Date(now()).toISOString() };
    if (Buffer.byteLength(JSON.stringify(entry.payload)) > 64000) throw new Error("Atlassian payload exceeds 64KB; shorten the public summary");
    const state = update(state => {
      if (state.entries.some(e => e.id === id && hash(e.payload) !== hash(entry.payload))) throw new Error("Ticket already queued with different content; review the existing remote ticket rather than create a duplicate");
      if (!state.entries.some(e => e.id === id)) state.entries.push(entry);
      else if (state.entries.find(e => e.id === id).status === "SUPERSEDED") {
        const previous = state.entries.find(e => e.id === id);
        Object.assign(previous, entry, { revision: (previous.revision || 0) + 1 });
      }
      return state;
    });
    return print(state.entries.find(e => e.id === id));
  }

  return async function command(args) {
    const { positional: [action, subject], options } = parseArgs(args);
    if (["priority-plan", "priority-apply", "priority-show", "priority-reconcile"].includes(action)) return print(await priorityBatch(action, subject, options));
    if (action === "consent") return print(consentCommand(root, subject, options, env, now));
    if (action === "mcp-tools") return print({ transport: "mcp", tools: await mcp.list(), notice: "Read-only schemas. Configure local bindings using these actual schemas; no remote writes or implicit approval." });
    if (["connect", "discover", "map", "check"].includes(action)) return print(await createConnectionCommand({ root, send, env })(action, options));
    if (action === "recovery") {
      const entries = read().entries.filter(e => !subject || e.id === subject);
      if (subject && !entries.length) throw new Error("Unknown outbox entry");
      return print(entries.map(recoveryAdvice));
    }
    if (action === "status") return print(read());
    if (action === "preview") {
      if (read().entries.some(e => e.status === "PENDING" && e.followup)) {
        const config = readConnection(root);
        update(state => {
          for (const entry of state.entries.filter(e => e.status === "PENDING" && e.followup)) {
            try { assertFollowup(root, entry.followup, config, reviewFingerprint); }
            catch { entry.status = "SUPERSEDED"; entry.error = "Local follow-up evidence/destination changed; repair and prepare a current draft"; }
          }
          return state;
        });
      }
      const items = preview(read());
      return print({ approval_digest: hash(items), items, notice: "Review all payloads before explicit publishing approval. No code, logs or credentials are collected automatically." });
    }
    if (action === "retry-rejected") {
      if (!subject || options.approve !== subject) throw new Error("Explicit --approve <entry-id> required");
      const state = update(state => {
        const entry = state.entries.find(e => e.id === subject);
        if (!entry || entry.status !== "REJECTED") throw new Error("Only a definitively rejected HTTP request can be queued again; reconcile unknown writes");
        Object.assign(entry, { status: "PENDING", revision: (entry.revision || 0) + 1 });
        return state;
      });
      return print(state);
    }
    const config = readConnection(root);
    if (action === "workflow") {
      const project = validateProjectId(options.project);
      if (!config.jira_projects[project]) throw new Error("Map the Jira project first");
      if (!["running", "blocked", "review-ready", "completed"].some(key => options[key] !== undefined)) {
        const types = await send(config, "jira", `/rest/api/3/project/${config.jira_projects[project]}/statuses`);
        if (!Array.isArray(types)) throw new Error("Invalid project workflow response");
        return print(types.map(type => ({ issue_type: type.id, statuses: (type.statuses || []).map(status => ({ id: status.id, name: status.name, category: status.statusCategory?.key })) })));
      }
      const values = { RUNNING: options.running, VERIFYING: options.running, BLOCKED: options.blocked,
        CHANGES_REQUESTED: options.blocked, REVIEW_READY: options["review-ready"], COMPLETED: options.completed };
      if (Object.values(values).some(v => !/^[0-9]+$/.test(v || "")) || values.REVIEW_READY === values.COMPLETED) throw new Error("Provide numeric --running --blocked --review-ready --completed; review and completed must differ");
      for (const id of new Set(Object.values(values))) {
        const status = await send(config, "jira", `/rest/api/3/status/${id}`);
        if (status.id !== id || !status.statusCategory?.key) throw new Error("Invalid Jira status response");
        if ((id === values.COMPLETED) !== (["done", "completed"].includes(status.statusCategory.key))) throw new Error("Only completed may use Jira's Done category");
      }
      updateJsonLocked(path.join(root, ".harness/local/atlassian.json"), null, current => {
        if (hash(readConnection(root)) !== hash(config)) throw new Error("Connection changed during workflow setup");
        return { ...current, workflow_statuses: { ...current.workflow_statuses, [project]: values } };
      });
      return print({ project, statuses: values, notice: "Local mapping only. Publication requires payload approval or current scoped consent." });
    }
    if (action === "link") {
      const requestId = validateProjectId(subject), ticketId = validateProjectId(options.ticket);
      const planFile = path.join(root, ".harness/local/requests", `${requestId}.json`);
      const plan = validateRequestPlan(readJson(planFile, null)), ticket = plan.tickets.find(t => t.ticket_id === ticketId);
      const entry = read().entries.find(e => e.service === "jira" && e.operation === "create" && e.request_id === requestId && e.ticket_id === ticketId);
      if (plan.status !== "DRAFT" || !ticket || !entry || entry.status !== "SYNCED" || !entry.ticket_snapshot || ticket.source) throw new Error("Link requires an unlinked DRAFT and its acknowledged queue-ticket publication");
      if (entry.ticket_snapshot !== hash(ticket) || !matchesConnection(entry.connection, config)
          || entry.payload.fields.project.key !== config.jira_projects[ticket.project_id]) throw new Error("Local ticket or connection changed since publication; review a fresh plan");
      const issue = await send(config, "jira", `/rest/api/3/issue/${entry.remote_id}?fields=summary,description,priority,project,updated,labels`);
      const requestedPriorityId = entry.payload.fields.priority?.id;
      if (String(issue.id) !== entry.remote_id || !issue.fields?.labels?.includes(entry.marker)
          || issue.fields.summary !== entry.payload.fields.summary || !publishedDescriptionMatches(issue.fields.description, entry.payload.fields.description)
          || (requestedPriorityId && issue.fields.priority?.id !== requestedPriorityId)) throw new Error("Published Jira content/priority changed; import and review rather than silently trusting the old plan");
      const source = snapshot(config, issue, config.jira_projects[ticket.project_id]);
      const linked = updateJsonLocked(planFile, null, current => {
        if (current?.status !== "DRAFT" || current.content_fingerprint !== plan.content_fingerprint) throw new Error("Plan changed during link");
        const target = current.tickets.find(t => t.ticket_id === ticketId);
        target.source = source;
        target.planning_status = target.acceptance_criteria?.length && target.implementation_steps?.length
          && (isArtifactTicket(target) || Object.values(target.test_plan || {}).some(v => v.length)) ? "READY" : "NEEDS_PLAN";
        current.content_fingerprint = planFingerprint(current);
        return validateRequestPlan(current);
      });
      return print(linked);
    }
    if (action === "search") return print({ ...await searchRemote(config, options.project, options.query, send, options), diagnostics: mcp.stats() });
    if (action === "context") return print(await fetchProjectPages(root, config, subject, send, now));
    if (action === "queue-status") {
      const projectId = validateProjectId(options.project), key = config.jira_projects[projectId];
      if (!/^[A-Z][A-Z0-9_]*-[1-9][0-9]*$/.test(options.issue || "") || !options.issue.startsWith(`${key}-`)
          || !/^[0-9]+$/.test(options["status-id"] || "")) throw new Error("Use a mapped --project, --issue KEY-1 and numeric --status-id");
      const issue = await send(config, "jira", `/rest/api/3/issue/${options.issue}?fields=project,status,updated`);
      if (issue.fields?.project?.key !== key || !/^[0-9]+$/.test(issue.id || "") || !/^[0-9]+$/.test(issue.fields?.status?.id || "")
          || typeof issue.fields?.updated !== "string") throw new Error("Jira status snapshot mismatch");
      const followup = options.followup ? bindFollowup(root, options.followup, config) : null;
      if (followup) {
        const intent = readIntent(root, followup.id);
        if (intent.kind !== "jira-status" || intent.fact.project_id !== projectId || intent.fact.source?.issue_key !== options.issue
            || config.workflow_statuses?.[projectId]?.[intent.fact.status] !== options["status-id"]) throw new Error("Follow-up status mismatch");
        assertFollowup(root, followup, config, reviewFingerprint);
        const destinationStatus = await send(config, "jira", `/rest/api/3/status/${options["status-id"]}`);
        if (destinationStatus.id !== options["status-id"] || !destinationStatus.statusCategory?.key || (intent.fact.status === "COMPLETED") !== ["done", "completed"].includes(destinationStatus.statusCategory.key)) throw new Error("Only human-accepted completion may transition to Done");
        await requireJiraFresh(root, { request_id: intent.fact.request_id, tickets: [intent.fact] }, { env, fetchImpl });
      }
      if (issue.fields.status.id === options["status-id"]) {
        if (!followup) return print({ status: "UNCHANGED", issue_id: issue.id });
        const entry = enqueue(config, projectId, "jira", { operation: "observed", followup }, () => ({}));
        update(state => { Object.assign(state.entries.find(e => e.id === entry.id), { status: "SYNCED", remote_id: issue.id, observed_at: new Date(now()).toISOString() }); return state; });
        return print({ ...entry, status: "SYNCED", operation: "observed" });
      }
      const available = await send(config, "jira", `/rest/api/3/issue/${issue.id}/transitions`);
      const choices = available.transitions?.filter(item => item.to?.id === options["status-id"] && /^[0-9]+$/.test(item.id));
      if (choices?.length !== 1) throw new Error("No unique available transition to the requested status; use Jira UI");
      const transition = { issue_id: issue.id, issue_key: options.issue, project_key: key, from_status: issue.fields.status.id,
        to_status: options["status-id"], updated: issue.fields.updated };
      return enqueue(config, projectId, "jira", { operation: "transition", transition, ...(followup ? { followup } : {}) }, () => ({ transition: { id: choices[0].id } }));
    }
    if (action === "queue-ticket") {
      const requestId = validateProjectId(subject), ticketId = validateProjectId(options.ticket);
      const requestFile = path.join(root, ".harness", "local", "requests", `${requestId}.json`);
      return withFileLock(requestFile, () => {
      const plan = readJson(requestFile, null);
      const ticket = plan?.tickets?.find(t => t.ticket_id === ticketId);
      const draft = ticketDraft(config, plan, ticket, requestId);
      return enqueue(config, ticket.project_id, "jira", draft.input, draft.build);
      });
    }
    if (action === "queue-result") {
      const projectId = validateProjectId(options.project);
      if (typeof options.file !== "string" || fs.statSync(options.file).size > 32768) throw new Error("Provide --file with a summary JSON up to 32KB");
      const input = readJson(options.file, null);
      if (!input || Object.keys(input).some(k => !["title", "summary", "request_id", "ticket_id"].includes(k))
          || typeof input.title !== "string" || !input.title.trim() || input.title.length > 180
          || typeof input.summary !== "string" || !input.summary.trim()) throw new Error("Result requires title, summary, request_id and ticket_id only");
      validateProjectId(input.request_id); validateProjectId(input.ticket_id);
      const destination = config.confluence_projects?.[projectId];
      if (!/^[0-9]+$/.test(destination?.space_id || "") || !/^[0-9]+$/.test(destination?.parent_id || "")) throw new Error("Configure Confluence space_id and parent_id");
      const followup = options.followup ? bindFollowup(root, options.followup, config) : null;
      if (followup) {
        const intent = readIntent(root, followup.id);
        if (intent.kind !== "confluence-result" || intent.fact.project_id !== projectId || hash(summaryInput(intent)) !== hash(input)) throw new Error("Follow-up result mismatch");
        assertFollowup(root, followup, config, reviewFingerprint);
      }
      return enqueue(config, projectId, "confluence", { ...input, destination, ...(followup ? { followup } : {}) }, marker => resultPayload(destination, input, marker));
    }
    if (action === "sync") {
      if (["true", "1"].includes(env.HARNESS_OFFLINE) || !env.ATLASSIAN_EMAIL || !env.ATLASSIAN_API_TOKEN) throw new Error("Online Atlassian credentials required before publishing");
      const state = read();
      const scoped = options.consent !== undefined;
      if (scoped && (options.approve || !options.project || !options.entry)) throw new Error("Consent sync requires --project and --entry; do not mix approval modes");
      const items = preview(state).filter(item => !scoped || item.id === options.entry);
      if (!items.length || (!scoped && options.approve !== hash(items))) throw new Error("Publishing requires the current preview approval_digest or a pending consent entry");
      const consentEntry = scoped ? state.entries.find(e => e.id === options.entry) : null;
      if (scoped && consentEntry.project_id !== options.project) throw new Error("Consent project mismatch");
      if (scoped) assertConsentedEntry(root, consentEntry, env, reviewFingerprint, options.consent);
      if (items.some(e => !matchesConnection(e.connection, config))) throw new Error("Atlassian destination changed; do not publish an old approval");
      for (const item of items) assertFollowup(root, item.followup, config, reviewFingerprint);
      if (transport(config) === "mcp") for (const item of items) {
        await mcp.prepare(config, item.service, item.operation === "transition" ? `/rest/api/3/issue/${item.transition.issue_id}/transitions`
          : item.service === "jira" ? "/rest/api/3/issue" : "/api/v2/pages", item.payload);
      }
      // Consume the entire approved batch before any POST. Crashes leave an explicit uncertain state.
      update(current => {
        if (hash(preview(current).filter(item => !scoped || item.id === options.entry)) !== hash(items)) throw new Error("Outbox changed since preview");
        for (const item of items) Object.assign(current.entries.find(e => e.id === item.id), { status: "SENDING", attempted_at: new Date(now()).toISOString(),
          authorization: scoped ? { kind: "standing-consent", grant_id: options.consent } : { kind: "payload", digest: options.approve } });
        return current;
      });
      for (const item of items) {
        try {
          try { assertFollowup(root, item.followup, readConnection(root), reviewFingerprint); }
          catch { throw Object.assign(new Error("Follow-up changed before submission"), { status: 409 }); }
          if (item.followup) {
            const intent = readIntent(root, item.followup.id);
            try { await requireJiraFresh(root, { request_id: intent.fact.request_id, tickets: [intent.fact] }, { env, fetchImpl }); }
            catch { throw Object.assign(new Error("Jira input changed before follow-up submission"), { status: 409 }); }
          }
          if (item.operation === "observed") {
            throw Object.assign(new Error("Read-only observation interrupted; inspect instead of POST"), { status: 409 });
          }
          if (item.operation === "transition") {
            const current = await send(config, "jira", `/rest/api/3/issue/${item.transition.issue_id}?fields=project,status,updated`);
            if (current.fields?.project?.key !== item.transition.project_key || current.fields?.status?.id !== item.transition.from_status
              || current.fields?.updated !== item.transition.updated) throw Object.assign(new Error("Jira changed after preview"), { status: 409 });
            if (scoped || transport(config) === "mcp") {
              const available = await send(config, "jira", `/rest/api/3/issue/${item.transition.issue_id}/transitions`);
              if (!available.transitions?.some(t => t.id === item.payload.transition.id && t.to?.id === item.transition.to_status)) throw Object.assign(new Error("Transition destination changed"), { status: 409 });
              if (scoped) {
                const destination = await send(config, "jira", `/rest/api/3/status/${item.transition.to_status}`);
                const intent = readIntent(root, item.followup.id);
                if (destination.id !== item.transition.to_status || !destination.statusCategory?.key || (intent.fact.status === "COMPLETED") !== ["done", "completed"].includes(destination.statusCategory.key)) throw Object.assign(new Error("Workflow category changed"), { status: 409 });
              }
            }
          }
          try { assertFollowup(root, item.followup, readConnection(root), reviewFingerprint); }
          catch { throw Object.assign(new Error("Follow-up changed during remote checks"), { status: 409 }); }
          if (!matchesConnection(item.connection, readConnection(root))) throw Object.assign(new Error("Connection changed before submission"), { status: 409 });
          if (scoped) {
            try { assertConsentedEntry(root, consentEntry, env, reviewFingerprint, options.consent); }
            catch { throw Object.assign(new Error("Standing consent or payload changed before POST"), { status: 409 }); }
          }
          const result = await send(config, item.service, item.operation === "transition" ? `/rest/api/3/issue/${item.transition.issue_id}/transitions`
            : item.service === "jira" ? "/rest/api/3/issue" : "/api/v2/pages", item.payload);
          if (item.operation === "transition") {
            if (transport(config) === "mcp") {
              const observed = await send(config, "jira", `/rest/api/3/issue/${item.transition.issue_id}?fields=project,status`);
              if (observed.id !== item.transition.issue_id || observed.fields?.project?.key !== item.transition.project_key
                  || observed.fields?.status?.id !== item.transition.to_status) throw new Error("Transition destination not confirmed");
            }
            result.id = item.transition.issue_id;
          }
          if (!/^[0-9]+$/.test(result.id || "")) throw new Error("Missing remote id");
          update(current => { Object.assign(current.entries.find(e => e.id === item.id), { status: "SYNCED", remote_id: result.id,
            remote_key: item.service === "jira" ? result.key : null, synced_at: new Date(now()).toISOString() }); return current; });
        } catch (error) {
          update(current => { Object.assign(current.entries.find(e => e.id === item.id), { status: [400, 401, 403, 404, 409, 422, 429].includes(error.status) ? "REJECTED" : "NEEDS_RECONCILIATION",
            error: error.status ? `HTTP ${error.status}` : "Remote write result unknown" }); return current; });
        }
      }
      const result = print(read());
      if (result.entries.some(e => items.some(item => item.id === e.id) && e.status !== "SYNCED")) throw new Error("Publishing incomplete; inspect atlassian status and reconcile uncertain writes");
      return result;
    }
    if (action === "reconcile") {
      const entry = read().entries.find(e => e.id === subject);
      if (!entry || !["SENDING", "NEEDS_RECONCILIATION"].includes(entry.status)
          || !/^[0-9]+$/.test(options["remote-id"] || "")) throw new Error("Reconcile requires an uncertain entry and numeric --remote-id");
      if (!matchesConnection(entry.connection, config)) throw new Error("Reconciliation destination changed");
      const id = options["remote-id"];
      const result = await send(config, entry.service, entry.service === "jira"
        ? `/rest/api/3/issue/${id}?fields=labels,project,status` : `/api/v2/pages/${id}?body-format=storage`);
      const matches = entry.operation === "transition"
        ? id === entry.transition.issue_id && result.fields?.project?.key === entry.transition.project_key && result.fields?.status?.id === entry.transition.to_status
        : entry.service === "jira"
        ? result.fields?.project?.key === entry.payload.fields.project.key && result.fields?.labels?.includes(entry.marker)
        : result.spaceId === entry.payload.spaceId && result.parentId === entry.payload.parentId && result.body?.storage?.value?.includes(entry.marker);
      if (String(result.id) !== id || !matches) throw new Error("Remote record does not match this outbox marker and destination");
      update(state => { Object.assign(state.entries.find(e => e.id === subject), { status: "SYNCED", remote_id: id, reconciled_at: new Date(now()).toISOString() }); return state; });
      return print(read());
    }
    throw new Error("Usage: atlassian <queue-ticket request --ticket id|queue-status --project id --issue KEY-1 --status-id id|queue-result --project id --file summary.json|preview|sync --approve digest|retry-rejected id --approve id|reconcile id --remote-id id|search --project id --query text|context project-id|priority-plan --project id --file json|priority-apply id --approve digest|priority-show id|priority-reconcile id|recovery [id]|status>");
  };
}

module.exports = { createAtlassianCommand };
