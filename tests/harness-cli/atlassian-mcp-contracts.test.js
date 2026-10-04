"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { normalizeResponse, publishedDescriptionMatches, ticketDescriptionJson } = require("../../tools/harness-cli/atlassian-mcp-contracts");
const { createAtlassianCommand } = require("../../tools/harness-cli/atlassian-command");
const { createRequestPlan } = require("../../tools/harness-cli/request-plan");
const adf = value => ({ type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: JSON.stringify(value, null, 2) }] }] });
const wrap = data => ({ data });
const normalize = (tool, operation, data, input = {}, read = async () => { throw new Error("Unexpected read"); }) => normalizeResponse({
  tool, input: { operation, cloudId: "cloud", ...input }, raw: wrap(data), mapped: data, read
});
const page = () => ({ id: "12", type: "page", status: "current", title: "Context", spaceId: "4", body: { format: "html", value: "<p>marker</p>" }, metadata: { version: { number: 2 } } });
const issue = () => ({ id: "30", key: "TEST-1", fields: { project: { key: "TEST" }, issuetype: { id: "8" } } });
const statusList = () => ({ statuses: [{ id: "2", name: "Review", category: "indeterminate" }], workTypes: [{ id: "8", statusIds: ["2"] }] });
const transitions = () => ({ transitions: [{ id: "21", to: { name: "Review", statusCategory: { key: "indeterminate" } } }] });

test("native project workflow status envelope joins work types with verified status identities", async () => {
  const value = { ...statusList(), mode: "project" };
  const result = await normalize("listJiraStatuses", "jira.projectStatuses", value);
  assert.equal(result[0].id, "8");
  assert.equal(result[0].statuses[0].statusCategory.key, "indeterminate");
  for (const change of [{ mode: "site" }, { workTypes: [] }, { workTypes: [{ id: "8", statusIds: ["999"] }] }, { workTypes: [{ id: "8", statusIds: ["2", "2"] }] }, { statuses: [...value.statuses, ...value.statuses] }]) {
    await assert.rejects(normalize("listJiraStatuses", "jira.projectStatuses", { ...value, ...change }), /workflow|unknown|duplicate/i);
  }
});

test("generated JSON descriptions compare across ADF/Markdown without accepting edits or arbitrary rich text", () => {
  const expected = adf({ goal: "A", nested: { max: 3 }, steps: ["one", "two"] });
  assert(publishedDescriptionMatches(expected, expected));
  assert(publishedDescriptionMatches('```json\n{"steps":["one","two"],"goal":"A","nested":{"max":3}}\n```', expected));
  assert(publishedDescriptionMatches(JSON.stringify(ticketDescriptionJson(expected)), expected));
  for (const actual of ['{"goal":"changed"}', 'prefix\n' + expected.content[0].content[0].text, '<pre>' + expected.content[0].content[0].text + '</pre>', 'null']) assert(!publishedDescriptionMatches(actual, expected));
  for (const bad of [null, adf("string"), adf([]), { ...expected, attrs: {} }, { ...expected, content: [...expected.content, ...expected.content] }, { ...expected, version: 2 }]) assert.equal(ticketDescriptionJson(bad), undefined);
  const marked = JSON.parse(JSON.stringify(expected)); marked.content[0].content[0].marks = [{ type: "strong" }];
  assert(!publishedDescriptionMatches(expected.content[0].content[0].text, marked));
  const invalid = adf({}); invalid.content[0].content[0].text = "broken"; assert.equal(ticketDescriptionJson(invalid), undefined);
});

test("real Confluence creation envelope validates remote destination, not a fabricated id", async () => {
  const content = { id: "12", type: "page", spaceId: "4", parentId: "5", title: "Context" };
  const input = { payload: { spaceId: "4", parentId: "5", title: "Context" } };
  assert.equal((await normalize("createConfluenceContent", "confluence.createPage", { ok: true, contentType: "page", content }, input)).id, "12");
  for (const change of [{ id: "bad" }, { parentId: "9" }, { spaceId: "9" }, { title: "other" }, { type: "folder" }]) await assert.rejects(normalize("createConfluenceContent", "confluence.createPage", { ok: true, contentType: "page", content: { ...content, ...change } }, input), /mismatch/);
  await assert.rejects(normalize("createConfluenceContent", "confluence.createPage", { ok: false }, input), /envelope/);
  await assert.rejects(normalize("createConfluenceContent", "confluence.createPage", { error: true }, input), /envelope/);
  assert.equal(await normalizeResponse({ raw: {}, mapped: "legacy" }), "legacy");
});

test("Confluence context and reconciliation get live parent evidence and fail closed on malformed ancestry", async () => {
  const data = page(), calls = [];
  const result = await normalize("getConfluenceContent", "confluence.getPage", data, { id: "12" }, async (name, args) => { calls.push({ name, args }); return wrap({ results: [{ id: "1" }, { id: "5" }] }); });
  assert.equal(result.parentId, "5"); assert.equal(result.version.number, 2); assert.equal(result.body.storage.value, data.body.value);
  assert.equal(calls[0].name, "getConfluenceContentAncestors"); assert.equal(calls[0].args.contentId, "12");
  assert.equal((await normalize("getConfluenceContent", "confluence.getPage", data, { id: "12" }, async () => wrap({ results: [] }))).parentId, null);
  for (const ancestors of [{}, { results: [{ id: "12" }] }, { results: [{ id: "5" }, { id: "5" }] }, { results: [{ id: "x" }] }, { results: [], _links: { next: "more" } }]) await assert.rejects(normalize("getConfluenceContent", "confluence.getPage", data, { id: "12" }, async () => wrap(ancestors)), /ancestor/);
  for (const change of [{ id: "99" }, { body: { format: "markdown", value: "x" } }, { metadata: { version: { number: 0 } } }, { status: "draft" }]) await assert.rejects(normalize("getConfluenceContent", "confluence.getPage", { ...data, ...change }, { id: "12" }), /mismatch/);
});

test("transition destinations resolve only unique names/categories in the actual project's work type", async () => {
  const read = async (name, args) => {
    if (name === "getJiraIssue") return wrap(issue());
    assert.equal(name, "listJiraStatuses"); assert.equal(args.projectKey, "TEST"); assert.equal(args.issueType, "8");
    return wrap(statusList());
  };
  assert.equal((await normalize("listJiraIssueTransitions", "jira.listTransitions", transitions(), { id: "TEST-1" }, read)).transitions[0].to.id, "2");
  for (const list of [{}, { ...statusList(), workTypes: [] }, { ...statusList(), statuses: [{ id: "x", name: "Review", category: "indeterminate" }] }, { ...statusList(), statuses: [...statusList().statuses, ...statusList().statuses] }, { statuses: [...statusList().statuses, { id: "3", name: "Review", category: "indeterminate" }], workTypes: [{ id: "8", statusIds: ["2", "3"] }] }, { ...statusList(), statuses: [{ id: "2", name: "Other", category: "indeterminate" }] }]) {
    await assert.rejects(normalize("listJiraIssueTransitions", "jira.listTransitions", transitions(), { id: "30" }, async name => wrap(name === "getJiraIssue" ? issue() : list)));
  }
  await assert.rejects(normalize("listJiraIssueTransitions", "jira.listTransitions", transitions(), { id: "999" }, read), /identity/);
  await assert.rejects(normalize("listJiraIssueTransitions", "jira.listTransitions", {}, { id: "30" }), /response/);
  const old = { transitions: [{ id: "21", to: { id: "2" } }] };
  assert.equal(await normalize("listJiraIssueTransitions", "jira.listTransitions", old), old);
  assert.equal((await normalize("listJiraStatuses", "jira.getStatus", statusList(), { id: "2" })).statusCategory.key, "indeterminate");
  await assert.rejects(normalize("listJiraStatuses", "jira.getStatus", statusList(), { id: "9" }), /identity/);
  assert.deepEqual(await normalize("getJiraCurrentUser", "jira.currentUser", { accountId: "a" }), { accountId: "a" });
});

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const local = path.join(root, ".harness/local"), ref = $ref => ({ $ref });
  const cfg = { site: "https://test.atlassian.net", cloud_id: "12345678-1234-1234-1234-123456789abc", jira_projects: { demo: "TEST" }, jira_issue_types: { demo: "8" }, priority_map: { "3": "P2" }, confluence_projects: { demo: { space_id: "4", parent_id: "5", context_page_ids: ["12"] } }, mcp: { bindings: {} } };
  function binding(key, tool, arguments_) { cfg.mcp.bindings[key] = { tool, arguments: arguments_, result: ref("/data") }; }
  binding("confluence.createPage", "createConfluenceContent", { cloudId: ref("/cloudId"), parent: { spaceId: ref("/payload/spaceId"), parentContentId: ref("/payload/parentId") }, title: ref("/payload/title"), body: { value: ref("/payload/body/value") }, private: true });
  binding("confluence.getPage", "getConfluenceContent", { cloudId: ref("/cloudId"), content_id: ref("/id") });
  binding("jira.createIssue", "createJiraIssue", { cloudId: ref("/cloudId"), summary: ref("/payload/fields/summary"), description: ref("/payload/fields/description/content/0/content/0/text"), labels: ref("/payload/fields/labels") });
  binding("jira.getIssue", "getJiraIssue", { cloudId: ref("/cloudId"), issueIdOrKey: ref("/id") });
  binding("jira.listTransitions", "listJiraIssueTransitions", { cloudId: ref("/cloudId"), issueIdOrKey: ref("/id") });
  binding("jira.transitionIssue", "transitionJiraIssue", { cloudId: ref("/cloudId"), issueIdOrKey: ref("/id"), transitionId: ref("/payload/transition/id") });
  const save = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(data)); };
  save(path.join(local, "atlassian.json"), cfg);
  const plan = createRequestPlan({ profiles: { demo: { status: "APPROVED", content_fingerprint: "fixture", verify_commands: ["npm test"] } }, requestId: "demo-request", goal: "Test", tickets: [{ ticket_id: "feature", project_id: "demo", goal: "Feature", acceptance_criteria: ["works"], implementation_steps: ["implement"], test_plan: { unit: ["verify"] } }] });
  save(path.join(local, "requests/demo-request.json"), plan);
  const summary = path.join(root, "summary.json"); save(summary, { title: "Context", summary: "Test", request_id: "demo-request", ticket_id: "context" });
  const state = { writes: 0, loseAck: false, parent: "5", transitionNoop: false, ambiguous: false };
  const remoteIssue = { ...issue(), fields: { ...issue().fields, summary: "Feature", description: "", labels: [], priority: { id: "3" }, updated: "v1", status: { id: "1" } } };
  let content = page();
  const fetchImpl = async (_url, init) => {
    const request = JSON.parse(init.body); let result;
    if (request.method === "initialize") result = { protocolVersion: "2025-06-18" };
    else if (request.method === "notifications/initialized") return new globalThis.Response(null, { status: 202 });
    else if (request.method === "tools/list") result = { tools: [...new Set([...Object.values(cfg.mcp.bindings).map(b => b.tool), "getConfluenceContentAncestors", "listJiraStatuses"])].map(name => ({ name })) };
    else {
      const { name, arguments: args } = request.params; let data;
      if (name === "createConfluenceContent") {
        state.writes++; content = { ...page(), title: args.title, body: { format: "html", value: args.body.value } };
        if (state.loseAck) { state.loseAck = false; throw new Error("lost"); }
        data = { ok: true, contentType: "page", content: { id: "12", type: "page", spaceId: "4", parentId: "5", title: args.title } };
      } else if (name === "getConfluenceContent") data = content;
      else if (name === "getConfluenceContentAncestors") data = { results: [{ id: state.parent }] };
      else if (name === "createJiraIssue") { state.writes++; assert.match(args.description, /^```json\n/); Object.assign(remoteIssue.fields, { description: args.description, labels: args.labels }); data = { id: "30", key: "TEST-1" }; }
      else if (name === "getJiraIssue") data = remoteIssue;
      else if (name === "listJiraIssueTransitions") data = transitions();
      else if (name === "listJiraStatuses") { data = statusList(); if (state.ambiguous) { data.statuses.push({ id: "3", name: "Review", category: "indeterminate" }); data.workTypes[0].statusIds.push("3"); } }
      else if (name === "transitionJiraIssue") { state.writes++; if (!state.transitionNoop) remoteIssue.fields.status.id = "2"; data = { message: "Transitioned", transitionId: 21, statusName: "Review" }; }
      else throw new Error("Unexpected tool");
      result = { content: [{ type: "text", text: JSON.stringify({ data }) }] };
    }
    return new globalThis.Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }));
  };
  const parseArgs = args => { const positional = [], options = {}; for (let i = 0; i < args.length; i++) args[i].startsWith("--") ? options[args[i].slice(2)] = args[++i] : positional.push(args[i]); return { positional, options }; };
  const command = createAtlassianCommand({ root, parseArgs, log: () => {}, env: { ATLASSIAN_EMAIL: "test@example.com", ATLASSIAN_API_TOKEN: "test" }, fetchImpl });
  return { root, state, command, summary, remoteIssue };
}

test("native envelopes pass managed creation, JSON link, context, transition and replay guards", async t => {
  const f = setup(t);
  await f.command(["queue-result", "--project", "demo", "--file", f.summary]);
  await f.command(["queue-ticket", "demo-request", "--ticket", "feature"]);
  const approval = (await f.command(["preview"])).approval_digest;
  await assert.rejects(f.command(["sync", "--approve", "wrong"])); assert.equal(f.state.writes, 0);
  await f.command(["sync", "--approve", approval]); assert.equal(f.state.writes, 2);
  await assert.rejects(f.command(["sync", "--approve", approval])); assert.equal(f.state.writes, 2);
  const linked = await f.command(["link", "demo-request", "--ticket", "feature"]);
  assert.equal(linked.status, "DRAFT"); assert.equal(linked.tickets[0].source.issue_key, "TEST-1");
  assert.equal((await f.command(["context", "demo"])).pages[0].version, 2);
  await f.command(["queue-status", "--project", "demo", "--issue", "TEST-1", "--status-id", "2"]);
  await f.command(["sync", "--approve", (await f.command(["preview"])).approval_digest]);
  assert.equal(f.remoteIssue.fields.status.id, "2");
  assert((await f.command(["status"])).entries.every(e => e.status === "SYNCED"));
});

test("lost page acknowledgement reconciles only actual matching parent without duplicate POST", async t => {
  const f = setup(t); f.state.loseAck = true;
  const entry = await f.command(["queue-result", "--project", "demo", "--file", f.summary]);
  await assert.rejects(f.command(["sync", "--approve", (await f.command(["preview"])).approval_digest]), /incomplete/);
  assert.equal(f.state.writes, 1); f.state.parent = "99";
  await assert.rejects(f.command(["reconcile", entry.id, "--remote-id", "12"]), /does not match/);
  f.state.parent = "5";
  await f.command(["reconcile", entry.id, "--remote-id", "12"]); assert.equal(f.state.writes, 1);
  assert.equal((await f.command(["status"])).entries[0].status, "SYNCED");
});

test("edited ticket JSON, changed transition evidence and false transition acknowledgements are blocked", async t => {
  const f = setup(t);
  await f.command(["queue-ticket", "demo-request", "--ticket", "feature"]);
  await f.command(["sync", "--approve", (await f.command(["preview"])).approval_digest]);
  f.remoteIssue.fields.description = f.remoteIssue.fields.description.replace('"goal": "Feature"', '"goal": "Edited"');
  await assert.rejects(f.command(["link", "demo-request", "--ticket", "feature"]), /changed/);
  await f.command(["queue-status", "--project", "demo", "--issue", "TEST-1", "--status-id", "2"]);
  f.state.ambiguous = true;
  await assert.rejects(f.command(["sync", "--approve", (await f.command(["preview"])).approval_digest]), /incomplete/);
  assert.equal(f.state.writes, 1);
  const g = setup(t); g.state.transitionNoop = true;
  await g.command(["queue-status", "--project", "demo", "--issue", "TEST-1", "--status-id", "2"]);
  await assert.rejects(g.command(["sync", "--approve", (await g.command(["preview"])).approval_digest]), /incomplete/);
  assert.equal((await g.command(["status"])).entries[0].status, "NEEDS_RECONCILIATION");
});

test("variable-length JSON fences accept exact content only and reject mismatched delimiters", () => {
  const { publishedDescriptionMatches } = require("../../tools/harness-cli/atlassian-mcp-contracts");
  const text = JSON.stringify({ request_id: "work", nested: "```example```" });
  const expected = { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
  for (const length of [3, 4, 5]) {
    const fence = "`".repeat(length);
    assert.equal(publishedDescriptionMatches(`${fence}json\n${text}\n${fence}`, expected), true);
  }
  assert.equal(publishedDescriptionMatches("````json\n" + text + "\n```", expected), false);
  assert.equal(publishedDescriptionMatches("````json\n" + JSON.stringify({ request_id: "changed" }) + "\n````", expected), false);
  assert.equal(publishedDescriptionMatches("prefix\n````json\n" + text + "\n````", expected), false);
});
