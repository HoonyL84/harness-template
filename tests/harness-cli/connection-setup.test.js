"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createAtlassianCommand } = require("../../tools/harness-cli/atlassian-command");
const { writeJsonAtomic, readJson } = require("../../tools/harness-cli/control-plane-state");
const { checkProviders } = require("../../tools/harness-cli/provider-connection");
const parseArgs = args => {
  const positional = [], options = {};
  for (let i = 0; i < args.length; i++) args[i].startsWith("--") ? options[args[i].slice(2)] = args[++i] : positional.push(args[i]);
  return { positional, options };
};
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "connection-setup-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const file = path.join(root, ".harness/local/atlassian.json");
  writeJsonAtomic(path.join(root, ".harness/local/projects.json"), { schema_version: "1.0", projects: { demo: { id: "demo", path: root } } });
  const env = { ATLASSIAN_EMAIL: "test@example.com", ATLASSIAN_API_TOKEN: "secret-value" }, calls = [];
  let answer = url => {
    if (url.includes("/myself")) return { accountId: "user" };
    if (url.includes("/priority/search")) return { values: [{ id: "1", name: "High" }], isLast: true };
    if (url.includes("/priority/1")) return { id: "1" };
    if (url.includes("/project/search")) return { values: [{ id: "10", key: "DEMO", name: "Demo" }], isLast: false };
    if (url.includes("/project/DEMO")) return { key: "DEMO", issueTypes: [{ id: "1", name: "Task", subtask: false }] };
    if (url.includes("/spaces/12")) return { id: "12", key: "PERSONAL" };
    if (url.includes("/pages/")) return { id: url.split("/").at(-1), spaceId: "12", status: "current" };
    return { results: [{ id: "12", key: "PERSONAL", name: "Personal" }], _links: {} };
  };
  const cmd = createAtlassianCommand({ root, parseArgs, env, log: () => {}, fetchImpl: async (url, init) => {
    calls.push({ url, init }); const body = await answer(url, init);
    return body instanceof globalThis.Response ? body : new globalThis.Response(JSON.stringify(body));
  } });
  return { root, file, env, calls, cmd, setAnswer: fn => { answer = fn; } };
}
const connect = ["connect", "--site", "https://personal.atlassian.net", "--transport", "rest"];
const map = ["map", "--project", "demo", "--jira-project", "DEMO", "--issue-type", "1", "--space-id", "12", "--parent-id", "34", "--context-pages", "35,36", "--priority-map", "1:P1"];

test("Atlassian connection saves no secrets, validates mapping with GET only and retains other mappings", async t => {
  const f = fixture(t);
  assert.equal((await f.cmd(connect)).status, "configured-not-verified"); assert.equal(f.calls.length, 0);
  const checked = await f.cmd(["check"]);
  assert.equal(checked.jira.status, "readable"); assert.equal(checked.confluence.status, "readable");
  const discovered = await f.cmd(["discover"]);
  assert.equal(discovered.jira.truncated, true); assert.equal(discovered.priorities.values[0].id, "1");
  assert.equal((await f.cmd(["discover", "--jira-project", "DEMO", "--space-id", "12"])).jira.issue_types[0].id, "1");
  assert.equal((await f.cmd(map)).status, "mapped-read-verified");
  const config = readJson(f.file);
  assert.equal(config.priority_map["1"], "P1"); assert.deepEqual(config.confluence_projects.demo.context_page_ids, ["35", "36"]);
  config.jira_projects.other = "OTHER"; writeJsonAtomic(f.file, config);
  await f.cmd(connect); await f.cmd(map);
  assert.equal(readJson(f.file).jira_projects.other, "OTHER");
  assert.ok(f.calls.every(c => c.init.method === "GET" && c.init.redirect === "error"));
  assert.doesNotMatch(fs.readFileSync(f.file, "utf8"), /secret-value|test@example.com/);
  await assert.rejects(f.cmd(["connect", "--site", "https://evil.example"]), /tenant/);
  await assert.rejects(f.cmd(["connect", "--site", "https://another.atlassian.net"]), /cannot be replaced/);
  await assert.rejects(f.cmd([...connect, "--token", "never-send-this"]), /credentials belong/);
});

test("Atlassian mapping rejects wrong pages, unregistered projects, races and unapproved remaps", async t => {
  const f = fixture(t); await f.cmd(connect); await f.cmd(map);
  const original = fs.readFileSync(f.file, "utf8");
  await assert.rejects(f.cmd([...map, "--project", "unknown"]), /Register/);
  await assert.rejects(f.cmd([...map, "--issue-type", "bad"]), /Use/);
  await assert.rejects(f.cmd([...map, "--priority-map", "1:urgent"]), /priority-map/);
  await assert.rejects(f.cmd([...map, "--priority-map", "1:P2"]), /--replace/);
  await f.cmd([...map, "--priority-map", "1:P2", "--replace", "true"]);
  assert.equal(readJson(f.file).priority_map["1"], "P2");
  fs.writeFileSync(f.file, original);
  f.setAnswer(url => url.includes("/project/") ? { key: "DEMO", issueTypes: [{ id: "1", subtask: false }] }
    : url.includes("/spaces/") ? { id: "12", key: "PERSONAL" } : { id: "34", spaceId: "wrong", status: "current" });
  await assert.rejects(f.cmd(map), /selected space/);
  assert.equal(fs.readFileSync(f.file, "utf8"), original);
  f.setAnswer(url => {
    const state = readJson(f.file); state.priority_map["99"] = "P3"; writeJsonAtomic(f.file, state);
    if (url.includes("/project/")) return { key: "DEMO", issueTypes: [{ id: "1", subtask: false }] };
    if (url.includes("/spaces/")) return { id: "12", key: "PERSONAL" };
    if (url.includes("/priority/")) return { id: "1" };
    return { id: url.split("/").at(-1), spaceId: "12", status: "current" };
  });
  await assert.rejects(f.cmd(map), /changed during validation/);
});

test("Atlassian diagnostics isolate permissions and missing/offline setup; scoped tokens use gateway", async t => {
  const f = fixture(t);
  await f.cmd([...connect, "--cloud-id", "12345678-1234-1234-1234-123456789abc"]);
  f.setAnswer(url => url.includes("/jira/") ? new globalThis.Response("secret-error", { status: 403 }) : { results: [] });
  const result = await f.cmd(["check"]);
  assert.equal(result.jira.status, "permission-denied"); assert.equal(result.confluence.status, "readable");
  assert.ok(f.calls.every(c => c.url.startsWith("https://api.atlassian.com/ex/")));
  assert.doesNotMatch(JSON.stringify(result), /secret/);
  f.env.HARNESS_OFFLINE = "true"; const count = f.calls.length;
  assert.equal((await f.cmd(["check"])).jira.status, "offline"); assert.equal(f.calls.length, count);
  delete f.env.HARNESS_OFFLINE; delete f.env.ATLASSIAN_API_TOKEN;
  assert.equal((await f.cmd(["discover"])).jira.status, "missing-credentials");
});

test("three provider diagnostics use header credentials and no generation, with independent failures", async () => {
  const env = { OPENAI_API_KEY: "open-secret", ANTHROPIC_API_KEY: "ant-secret", GEMINI_API_KEY: "gem-secret" }, calls = [];
  const report = await checkProviders({ env, fetchImpl: async (url, init) => {
    calls.push(url); assert.equal(init.method, "GET"); assert.equal(init.redirect, "error"); assert.doesNotMatch(url, /secret/);
    if (url.includes("anthropic")) return new globalThis.Response("ant-secret", { status: 401 });
    if (url.includes("googleapis")) { assert.equal(init.headers["x-goog-api-key"], "gem-secret"); return new globalThis.Response('{"models":[]}'); }
    assert.equal(init.headers.Authorization, "Bearer open-secret"); return new globalThis.Response('{"data":[]}');
  } });
  assert.deepEqual(report.providers.map(p => p.status), ["connected", "permission-denied", "connected"]);
  assert.equal(calls.length, 3); assert.doesNotMatch(JSON.stringify(report), /secret/);
  await assert.rejects(checkProviders({ provider: "other" }), /Unknown/);
  assert.equal((await checkProviders({ provider: "gemini", env: { GEMINI_API_KEY: "AIza..." } })).providers[0].status, "missing-key");
  assert.equal((await checkProviders({ provider: "gemini", env: { ...env, HARNESS_OFFLINE: "1" } })).providers[0].status, "offline");
  assert.equal((await checkProviders({ provider: "gemini", env, fetchImpl: async () => new globalThis.Response("{}") })).providers[0].status, "unavailable");
  assert.equal((await checkProviders({ provider: "openai", env, fetchImpl: async () => { throw new Error("open-secret"); } })).providers[0].status, "unavailable");
});
