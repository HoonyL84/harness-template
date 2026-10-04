"use strict";

// The hosted MCP endpoint owns Atlassian API details. Bindings come from its actual tool schemas.
const ENDPOINT = "https://mcp.atlassian.com/v2/mcp?tools=all";
const LIMIT = 256 * 1024;
const { normalizeResponse, ticketDescriptionJson } = require("./atlassian-mcp-contracts");
const READ_TOOLS = new Set(["atlassianUserInfo", "getAccessibleAtlassianResources", "getJiraIssue", "listJiraProjects",
  "listJiraProjectIssueTypesMetadata", "listJiraIssueTransitions", "listJiraStatuses", "getJiraCurrentUser",
  "searchJiraIssuesUsingJql", "getConfluenceContent", "listConfluenceContent", "listConfluenceSpaces", "getConfluenceSpace",
  "getConfluenceContentAncestors", "searchConfluence", "getTeamworkGraphContext", "getTeamworkGraphObject", "search", "executeRead"]);
const WRITE_TOOLS = { "jira.createIssue": "createJiraIssue", "jira.transitionIssue": "transitionJiraIssue", "confluence.createPage": "createConfluenceContent", "jira.updatePriority": "editJiraIssue" };

function transport(config) {
  const mode = config.transport ?? "mcp";
  if (!["mcp", "rest"].includes(mode)) throw new Error("Atlassian transport must be mcp or rest");
  return mode;
}

/** Credential-free identity; changing adapters/bindings invalidates existing publication approval. */
function connectionIdentity(config) {
  return { site: config.site, cloud_id: config.cloud_id || null, transport: transport(config),
    ...(transport(config) === "mcp" ? { mcp: config.mcp || {} } : {}) };
}

function matchesConnection(record, config) {
  // Pre-MCP outbox records were REST-only. Preserve their reconciliation path, not their old consents.
  const previous = { ...record, transport: record.transport || "rest" };
  return JSON.stringify(previous) === JSON.stringify(connectionIdentity(config));
}

function operationFor(service, endpoint, payload) {
  const url = new URL(endpoint, "https://local.invalid"), pathname = url.pathname;
  const routes = service === "confluence" ? [
    [/^\/api\/v2\/pages\/(\d+)$/, "getPage"], [/^\/api\/v2\/spaces\/(\d+)$/, "getSpace"],
    [/^\/api\/v2\/pages$/, payload ? "createPage" : "listPages"], [/^\/api\/v2\/spaces$/, "listSpaces"],
    [/^\/rest\/api\/search$/, "search"]
  ] : service === "jira" ? [
    [/^\/rest\/api\/3\/issue\/([A-Z0-9_-]+)\/transitions$/, payload ? "transitionIssue" : "listTransitions"],
    [/^\/rest\/api\/3\/issue\/([A-Z0-9_-]+)$/, "getIssue"], [/^\/rest\/api\/3\/issue$/, "createIssue"],
    [/^\/rest\/api\/3\/project\/([A-Z0-9_]+)\/statuses$/, "projectStatuses"],
    [/^\/rest\/api\/3\/project\/search$/, "listProjects"], [/^\/rest\/api\/3\/project\/([A-Z0-9_]+)$/, "getProject"],
    [/^\/rest\/api\/3\/priority\/search$/, "listPriorities"], [/^\/rest\/api\/3\/priority\/(\d+)$/, "getPriority"],
    [/^\/rest\/api\/3\/status\/(\d+)$/, "getStatus"], [/^\/rest\/api\/3\/myself$/, "currentUser"],
    [/^\/rest\/api\/3\/search\/jql$/, "search"]
  ] : [];
  const route = routes.find(([pattern]) => pattern.test(pathname));
  if (!route) throw new Error("Unsupported managed MCP operation");
  let operation = `${service}.${route[1]}`;
  if (payload && operation === "jira.getIssue") {
    if (Object.keys(payload).join() !== "fields" || Object.keys(payload.fields || {}).join() !== "priority"
        || Object.keys(payload.fields.priority || {}).join() !== "name"
        || !["Highest", "High", "Medium", "Low", "Lowest"].includes(payload.fields.priority.name)) throw new Error("Only explicit Jira priority updates are supported");
    operation = "jira.updatePriority";
  }
  if (payload && !WRITE_TOOLS[operation]) throw new Error("Unsupported MCP write");
  return { operation, id: pathname.match(route[0])[1] || null, query: Object.fromEntries(url.searchParams), payload: payload || null };
}

/** JSON-pointer substitution only: no evaluation, scripts, filesystem access or remote URLs. */
function render(template, input, depth = 0) {
  if (depth > 30) throw new Error("MCP binding nesting too deep");
  if (template && typeof template === "object" && !Array.isArray(template) && Object.hasOwn(template, "$ref")) {
    if (Object.keys(template).some(key => !["$ref", "optional"].includes(key)) || (Object.hasOwn(template, "optional") && template.optional !== true)
        || typeof template.$ref !== "string" || !/^(\/[^\s]*)?$/.test(template.$ref)) throw new Error("Invalid MCP binding reference");
    let value = input;
    for (const key of template.$ref === "" ? [] : template.$ref.slice(1).split("/").map(k => k.replace(/~1/g, "/").replace(/~0/g, "~"))) {
      if (!value || typeof value !== "object" || !Object.hasOwn(value, key)) {
        if (template.optional === true) return undefined;
        throw new Error("MCP binding reference missing");
      }
      value = value[key];
    }
    return value;
  }
  if (Array.isArray(template)) return template.map(v => render(v, input, depth + 1));
  if (template && typeof template === "object") return Object.fromEntries(Object.entries(template).map(([k, v]) => [k, render(v, input, depth + 1)]));
  return template;
}

async function readRpc(response, id) {
  const sse = response.headers.get("content-type")?.includes("text/event-stream");
  let bytes = 0, buffer = "";
  const decoder = new globalThis.TextDecoder();
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    if (bytes > LIMIT) throw new Error("MCP response exceeds 256KB");
    buffer += decoder.decode(chunk, { stream: true });
    if (sse) {
      let boundary;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const event = buffer.slice(0, boundary.index); buffer = buffer.slice(boundary.index + boundary[0].length);
        const data = event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        const message = JSON.parse(data);
        if (message.id === id) return message;
      }
    }
  }
  if (sse) throw new Error("MCP stream ended without matching response");
  return JSON.parse(buffer + decoder.decode());
}

function createMcpClient({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  let session, version = "2025-06-18", nextId = 0, ready;
  const metrics = { requests: 0, initialize: 0, catalogs: 0, tool_calls: 0, elapsed_ms: 0 };
  const rpc = async (method, params, notification = false) => {
    if (["true", "1"].includes(env.HARNESS_OFFLINE)) throw new Error("MCP unavailable offline");
    if (!env.ATLASSIAN_EMAIL || !env.ATLASSIAN_API_TOKEN) throw new Error("Configure MCP API-token credentials locally, or use the host's connected MCP tools");
    const id = notification ? undefined : ++nextId;
    metrics.requests++;
    if (method === "initialize") metrics.initialize++;
    if (method === "tools/list") metrics.catalogs++;
    if (method === "tools/call") metrics.tool_calls++;
    const started = Date.now();
    let response;
    try {
      response = await fetchImpl(ENDPOINT, { method: "POST", redirect: "error", signal: globalThis.AbortSignal.timeout(15000),
        headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json", "MCP-Protocol-Version": version,
          ...(session ? { "Mcp-Session-Id": session } : {}), Authorization: `Basic ${Buffer.from(`${env.ATLASSIAN_EMAIL}:${env.ATLASSIAN_API_TOKEN}`).toString("base64")}` },
        body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, params }) });
      if (!response.ok) { await response.body?.cancel(); throw new Error("MCP HTTP failure"); }
      if (notification) { await response.body?.cancel(); return; }
      const message = await readRpc(response, id);
      if (message.jsonrpc !== "2.0" || message.id !== id || message.error || !Object.hasOwn(message, "result")) throw new Error("Invalid MCP response");
      if (method === "initialize") {
        const negotiated = message.result.protocolVersion;
        if (!["2025-03-26", "2025-06-18", "2025-11-25"].includes(negotiated)) throw new Error("Unsupported MCP protocol");
        version = negotiated;
        session = response.headers.get("mcp-session-id");
      }
      return message.result;
    } catch { throw new Error("MCP request failed; no REST fallback. A submitted write may require reconciliation."); }
    finally { metrics.elapsed_ms += Date.now() - started; }
  };
  const initialize = () => ready ||= (async () => {
    await rpc("initialize", { protocolVersion: version, capabilities: {}, clientInfo: { name: "harness", version: "1.0.0" } });
    await rpc("notifications/initialized", {}, true);
  })();
  const loadList = async () => {
    await initialize();
    const tools = [], seen = new Set(); let cursor;
    for (let page = 0; page < 20; page++) {
      const result = await rpc("tools/list", cursor ? { cursor } : {});
      if (!Array.isArray(result.tools)) throw new Error("Invalid MCP tool catalog");
      tools.push(...result.tools);
      if (!result.nextCursor) return tools;
      if (typeof result.nextCursor !== "string" || seen.has(result.nextCursor)) throw new Error("Invalid MCP tool cursor");
      cursor = result.nextCursor; seen.add(cursor);
    }
    throw new Error("MCP catalog truncated");
  };
  let catalog, listing;
  const list = async () => {
    if (catalog) return catalog;
    listing ||= loadList().then(value => { catalog = value; return value; }).finally(() => { listing = null; });
    return listing;
  };
  const prepare = async (config, service, endpoint, payload) => {
    const input = { ...operationFor(service, endpoint, payload), site: config.site, cloudId: config.cloud_id || null };
    const binding = config.mcp?.bindings?.[input.operation];
    if (!binding || typeof binding.tool !== "string" || !binding.arguments) throw new Error(`Configure MCP binding for ${input.operation} from atlassian mcp-tools; REST is opt-in only`);
    if (payload ? WRITE_TOOLS[input.operation] !== binding.tool : !READ_TOOLS.has(binding.tool)) throw new Error("MCP tool is not allowed for this managed operation");
    catalog ||= await list();
    if (!catalog.some(t => t.name === binding.tool)) throw new Error("Configured MCP tool unavailable; inspect permissions and current catalog");
    const args = render(binding.arguments, input);
    if (input.operation === "jira.updatePriority"
        && (JSON.stringify(Object.keys(args).sort()) !== JSON.stringify(["cloudId", "fields", "issueIdOrKey"])
          || args.cloudId !== input.cloudId || args.issueIdOrKey !== input.id
          || JSON.stringify(args.fields) !== JSON.stringify(payload.fields))) throw new Error("Priority binding must preserve exact approved destination and fields");
    if (input.operation === "jira.createIssue" && binding.tool === "createJiraIssue" && ticketDescriptionJson(payload?.fields?.description)
        && args.description === payload.fields.description.content[0].content[0].text) {
      args.description = "```json\n" + args.description + "\n```";
    }
    return { binding, input, call: { name: binding.tool, arguments: args } };
  };
  const invoke = async call => {
    const result = await rpc("tools/call", call);
    if (result.isError) throw new Error("MCP tool reported an error; reconcile writes before retrying");
    let data = result.structuredContent;
    if (data === undefined) {
      const text = result.content?.filter(c => c.type === "text");
      if (text?.length !== 1) throw new Error("MCP result needs structured JSON, not a narrative success claim");
      try { data = JSON.parse(text[0].text); } catch { throw new Error("MCP result needs structured JSON"); }
    }
    return data;
  };
  return { list, prepare, stats: () => ({ ...metrics }), async send(config, service, endpoint, payload) {
    const { binding, input, call } = await prepare(config, service, endpoint, payload);
    const raw = await invoke(call);
    const mapped = binding.result === undefined ? raw : render(binding.result, raw);
    const read = async (name, args) => {
      if (!READ_TOOLS.has(name) || !catalog.some(t => t.name === name)) throw new Error("Required MCP evidence tool unavailable");
      return invoke({ name, arguments: args });
    };
    return normalizeResponse({ raw, mapped, tool: binding.tool, input, call, read });
  } };
}

module.exports = { transport, connectionIdentity, matchesConnection, operationFor, render, createMcpClient };
