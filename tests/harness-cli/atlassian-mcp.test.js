"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const { createMcpClient, transport, connectionIdentity, matchesConnection, operationFor, render } = require("../../tools/harness-cli/atlassian-mcp");

function fixture(options = {}) {
  const calls = [], env = { ATLASSIAN_EMAIL: "test@example.com", ATLASSIAN_API_TOKEN: "secret" };
  const config = { site: "https://personal.atlassian.net", cloud_id: "12345678-1234-1234-1234-123456789abc",
    mcp: { bindings: { "confluence.getPage": { tool: "getConfluenceContent", arguments: { cloudId: { $ref: "/cloudId" }, id: { $ref: "/id" } }, result: { $ref: "/page" } } } } };
  const fetchImpl = async (url, init) => {
    assert.equal(url, "https://mcp.atlassian.com/v2/mcp?tools=all"); assert.equal(init.redirect, "error");
    assert.match(init.headers.Accept, /text\/event-stream/);
    const rpc = JSON.parse(init.body); calls.push(rpc);
    assert.doesNotMatch(init.body, /secret/);
    if (rpc.method !== "initialize") assert.equal(init.headers["Mcp-Session-Id"], "fixture-session");
    if (rpc.method === "notifications/initialized") return new globalThis.Response(null, { status: 202 });
    let result;
    if (rpc.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} } };
    else if (rpc.method === "tools/list") result = options.catalog || { tools: [{ name: "getConfluenceContent", inputSchema: { type: "object" } }] };
    else result = options.result || { structuredContent: { page: { id: rpc.params.arguments.id, version: { number: 3 }, body: "context" } } };
    const body = { jsonrpc: "2.0", id: options.badId ? -100 : rpc.id, result };
    return new globalThis.Response(options.sse ? `: keepalive\r\n\r\nevent: message\r\ndata: ${JSON.stringify(body)}\r\n\r\n` : JSON.stringify(body),
      { headers: { "mcp-session-id": "fixture-session", "content-type": options.sse ? "text/event-stream" : "application/json" } });
  };
  return { env, config, fetchImpl, calls, client: createMcpClient({ env, fetchImpl }) };
}

test("MCP is default; REST is explicit and both adapter and bindings are approval identity", () => {
  assert.equal(transport({}), "mcp"); assert.equal(transport({ transport: "rest" }), "rest");
  assert.throws(() => transport({ transport: "auto" }), /mcp or rest/);
  assert.notDeepEqual(connectionIdentity({ site: "s" }), connectionIdentity({ site: "s", transport: "rest" }));
  assert.notDeepEqual(connectionIdentity({ site: "s" }), connectionIdentity({ site: "s", mcp: { bindings: {} } }));
  assert.equal(matchesConnection({ site: "s", cloud_id: null }, { site: "s", transport: "rest" }), true);
  assert.equal(matchesConnection({ site: "s", cloud_id: null }, { site: "s" }), false);
});

test("Streamable HTTP JSON and SSE negotiate, propagate session, map schemas and return versioned content", async () => {
  for (const sse of [false, true]) {
    const f = fixture({ sse }), value = await f.client.send(f.config, "confluence", "/api/v2/pages/12?body-format=storage");
    assert.equal(value.id, "12"); assert.equal(value.version.number, 3);
    await f.client.send(f.config, "confluence", "/api/v2/pages/12");
    assert.equal(f.calls.filter(c => c.method === "initialize").length, 1);
    assert.equal(f.calls.filter(c => c.method === "tools/list").length, 1);
    assert.deepEqual(f.calls.at(-1).params.arguments, { cloudId: f.config.cloud_id, id: "12" });
  }
});

test("unconfigured, absent and unsafe tools fail without REST fallback or destructive calls", async () => {
  const f = fixture();
  await assert.rejects(f.client.send(f.config, "jira", "/rest/api/3/issue/ABC-1"), /binding/); assert.equal(f.calls.length, 0);
  f.config.mcp.bindings["confluence.getPage"].tool = "deleteJiraIssue";
  await assert.rejects(f.client.send(f.config, "confluence", "/api/v2/pages/12"), /not allowed/); assert.equal(f.calls.length, 0);
  f.config.mcp.bindings["confluence.getPage"].tool = "getJiraIssue";
  await assert.rejects(f.client.send(f.config, "confluence", "/api/v2/pages/12"), /unavailable/);
  assert.equal(f.calls.some(c => c.method === "tools/call"), false);
  f.config.mcp.bindings["confluence.createPage"] = { tool: "updateConfluenceContent", arguments: {} };
  await assert.rejects(f.client.send(f.config, "confluence", "/api/v2/pages", { title: "x" }), /not allowed/);
});

test("MCP errors, malformed ids and narrative acknowledgements never become successful records", async () => {
  for (const options of [{ badId: true }, { result: { isError: true } }, { result: { content: [{ type: "text", text: "done" }] } }]) {
    const f = fixture(options);
    await assert.rejects(f.client.send(f.config, "confluence", "/api/v2/pages/12"), /MCP/);
  }
  const f = fixture({ result: { content: [{ type: "text", text: '{"page":{"id":"12"}}' }] } });
  assert.equal((await f.client.send(f.config, "confluence", "/api/v2/pages/12")).id, "12");
});

test("offline, credential absence, untrusted endpoint and response limits fail closed", async () => {
  const f = fixture(); f.env.HARNESS_OFFLINE = "true";
  await assert.rejects(f.client.list(), /offline/); assert.equal(f.calls.length, 0);
  await assert.rejects(createMcpClient({ env: {}, fetchImpl: f.fetchImpl }).list(), /credentials/);
  assert.throws(() => operationFor("confluence", "/unexpected", {}), /Unsupported/);
  assert.throws(() => operationFor("confluence", "/api/v2/spaces/1", {}), /Unsupported/);
  assert.throws(() => render({ $ref: "/missing" }, {}), /missing/);
  assert.throws(() => render({ $ref: "/a", extra: 1 }, {}), /Invalid/);
  assert.deepEqual(render([{ $ref: "/a~1b/~0" }, 4], { "a/b": { "~": 2 } }), [2, 4]);
  const big = fixture({ result: { structuredContent: { page: "x".repeat(270000) } } });
  await assert.rejects(big.client.send(big.config, "confluence", "/api/v2/pages/12"), /MCP request failed/);
  const repeated = fixture({ catalog: { tools: [], nextCursor: "repeat" } });
  await assert.rejects(repeated.client.list(), /cursor/);
});
