"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { readJson, writeJsonAtomic } = require("../../tools/harness-cli/control-plane-state");
const { createOnboardingProfile, approveOnboardingProfile } = require("../../tools/harness-cli/project-onboarding");
const { createRequestCommand } = require("../../tools/harness-cli/request-command");
const { createAtlassianCommand } = require("../../tools/harness-cli/atlassian-command");
const { createFollowupCommand, captureFollowups, safeCaptureFollowups } = require("../../tools/harness-cli/operations-followup");
const { createHistoryCommand } = require("../../tools/harness-cli/work-history");
const { buildExecutionState } = require("../../tools/harness-cli/project-execution");
const { createAgentRunnerCommand } = require("../../tools/harness-cli/agent-runner");
const { createPublicationHook } = require("../../tools/harness-cli/operations-publish");
const { assertConsentedEntry, requireConsent } = require("../../tools/harness-cli/atlassian-consent");
function parseArgs(args) {
  const positional = [], options = {};
  for (let i = 0; i < args.length; i++) args[i].startsWith("--") ? options[args[i].slice(2)] = args[++i] : positional.push(args[i]);
  return { positional, options };
}
function fixture(t, useMcp = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "followups-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const local = path.join(root, ".harness/local"), project = { id: "demo", path: path.join(root, "project"), stacks: ["node"] };
  fs.mkdirSync(project.path);
  const diagnosis = { path: project.path, head: "abc", branch: "main", dirty: false, changed_paths: 0, worktree_fingerprint: "clean", remotes: {}, stacks: ["node"], verify_commands: ["node test.js"] };
  const profile = createOnboardingProfile(project, diagnosis, [], []);
  writeJsonAtomic(path.join(local, "profiles/demo.json"), approveOnboardingProfile(profile, profile));
  writeJsonAtomic(path.join(local, "projects.json"), { schema_version: "1.0", projects: { demo: project } });
  const config = { transport: "rest", site: "https://personal.atlassian.net", jira_projects: { demo: "DEMO" }, jira_issue_types: { demo: "1" }, priority_map: { "2": "P2" },
    confluence_projects: { demo: { space_id: "10", parent_id: "11" } },
    workflow_statuses: { demo: { RUNNING: "1", VERIFYING: "1", BLOCKED: "2", CHANGES_REQUESTED: "2", REVIEW_READY: "3", COMPLETED: "4" } } };
  if (useMcp) {
    config.transport = "mcp";
    const tools = { "jira.createIssue": "createJiraIssue", "jira.getIssue": "getJiraIssue", "jira.getStatus": "listJiraStatuses",
      "jira.listTransitions": "listJiraIssueTransitions", "jira.transitionIssue": "transitionJiraIssue", "confluence.createPage": "createConfluenceContent" };
    config.mcp = { bindings: Object.fromEntries(Object.entries(tools).map(([op, tool]) => [op, { tool, arguments: { request: { $ref: "" } } }])) };
  }
  const saveConfig = () => writeJsonAtomic(path.join(local, "atlassian.json"), config); saveConfig();
  let live = "verified", issue, postFailure = null, posts = 0;
  const env = { ATLASSIAN_EMAIL: "test@example.com", ATLASSIAN_API_TOKEN: "fixture" };
  const restFixture = async (url, init) => {
    if (init.method === "POST") {
      posts++;
      if (postFailure === "lost") throw new Error("simulated lost acknowledgement");
      if (postFailure) return new globalThis.Response("rejected", { status: postFailure });
      if (url.endsWith("/issue")) {
        const fields = JSON.parse(init.body).fields;
        issue = { id: "100", key: "DEMO-1", fields: { ...fields, status: { id: "0" }, updated: "v1" } };
        return new globalThis.Response(JSON.stringify({ id: "100", key: "DEMO-1" }));
      }
      if (url.includes("transitions")) { issue.fields.status.id = JSON.parse(init.body).transition.id; issue.fields.updated += "x"; return new globalThis.Response(null, { status: 204 }); }
      return new globalThis.Response('{"id":"200"}');
    }
    if (url.includes("/project/DEMO/statuses")) return new globalThis.Response(JSON.stringify([{ id: "1", statuses: [{ id: "3", name: "Review", statusCategory: { key: "indeterminate" } }] }]));
    if (url.includes("/status/")) { const id = url.split("/").at(-1); return new globalThis.Response(JSON.stringify({ id, statusCategory: { key: id === "4" ? "done" : "indeterminate" } })); }
    if (url.endsWith("/transitions")) return new globalThis.Response(JSON.stringify({ transitions: ["1", "2", "3", "4"].map(id => ({ id, to: { id } })) }));
    return new globalThis.Response(JSON.stringify(issue));
  };
  const envelopes = [];
  const fetchImpl = useMcp ? async (url, init) => {
    assert.equal(url, "https://mcp.atlassian.com/v2/mcp?tools=all");
    const rpc = JSON.parse(init.body); envelopes.push(rpc);
    if (rpc.method === "notifications/initialized") return new globalThis.Response(null, { status: 202 });
    let result;
    if (rpc.method === "initialize") result = { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } };
    else if (rpc.method === "tools/list") result = { tools: Object.values(config.mcp.bindings).map(b => ({ name: b.tool })) };
    else {
      const input = rpc.params.arguments.request;
      const endpoints = { "jira.createIssue": "/issue", "jira.getIssue": `/issue/${input.id}`,
        "jira.getStatus": `/status/${input.id}`, "jira.listTransitions": `/issue/${input.id}/transitions`,
        "jira.transitionIssue": `/issue/${input.id}/transitions`, "confluence.createPage": "/pages" };
      const response = await restFixture(endpoints[input.operation], { method: input.payload ? "POST" : "GET", body: JSON.stringify(input.payload) });
      result = response.ok ? { structuredContent: response.status === 204 ? {} : await response.json() } : { isError: true, content: [{ type: "text", text: "fixture rejected" }] };
    }
    return new globalThis.Response(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }), { headers: { "Content-Type": "application/json" } });
  } : restFixture;
  const shared = { root, parseArgs, log: () => {}, env, fetchImpl, reviewFingerprint: () => live };
  const request = createRequestCommand(shared), atlassian = createAtlassianCommand(shared), operations = createFollowupCommand({ ...shared, atlassian });
  const file = path.join(root, "plan.json");
  writeJsonAtomic(file, { goal: "Test feature", tickets: [{ ticket_id: "feature", project_id: "demo", goal: "Reject invalid values", acceptance_criteria: ["reject zero"], implementation_steps: ["add guard"], test_plan: { unit: ["guard regression"] } }] });
  request(["create", "work", "--plan-file", file]);
  const publish = async () => { const p = await atlassian(["preview"]); return atlassian(["sync", "--approve", p.approval_digest]); };
  const link = async () => { await atlassian(["queue-ticket", "work", "--ticket", "feature"]); await publish(); return atlassian(["link", "work", "--ticket", "feature"]); };
  const stateFile = path.join(local, "executions/work.json");
  const prepareState = async (status = "REVIEW_READY") => {
    const plan = await request(["approve", "work"]), state = buildExecutionState(plan, root);
    const ticket = state.tickets[0]; fs.mkdirSync(ticket.worktree, { recursive: true });
    Object.assign(ticket, { status, runner: { attempts: 1 }, ...(status === "REVIEW_READY" ? { verification: { content_fingerprint: "verified", results: [{ command: "node test.js --token secret-value", status: 0 }] } } : {}) });
    state.status = status; writeJsonAtomic(stateFile, state); return state;
  };
  const grant = async () => {
    const preview = await atlassian(["consent", "preview", "--project", "demo"]);
    return atlassian(["consent", "grant", "--project", "demo", "--approve", preview.approval_digest]);
  };
  return { ...shared, local, request, atlassian, operations, config, saveConfig, publish, link, prepareState, stateFile,
    grant, envelopes,
    history: createHistoryCommand(shared), issue: () => issue, setLive: v => { live = v; }, setFailure: v => { postFailure = v; }, posts: () => posts };
}

test("published DRAFT links in place with unchanged plans, default attempts and a new approval fingerprint", async t => {
  const f = fixture(t), before = f.request(["show", "work"]);
  const linked = await f.link();
  assert.equal(linked.status, "DRAFT"); assert.equal(linked.tickets[0].ticket_id, "feature"); assert.equal(linked.tickets[0].source.issue_key, "DEMO-1");
  assert.deepEqual(linked.tickets[0].implementation_steps, before.tickets[0].implementation_steps);
  assert.deepEqual(linked.tickets[0].test_plan, before.tickets[0].test_plan);
  assert.equal(linked.tickets[0].retry_policy.max_attempts, 3); assert.notEqual(linked.content_fingerprint, before.content_fingerprint);
  assert.equal((await f.request(["approve", "work"])).status, "APPROVED");
});

test("MCP transport preserves DRAFT, input freshness, consent, result recording and uncertainty gates end to end", async t => {
  const f = fixture(t, true); await f.grant();
  await f.operations(["flush", "--request", "work"]);
  assert.equal(f.request(["show", "work"]).status, "DRAFT");
  await f.prepareState(); await f.operations(["flush", "--request", "work"]);
  assert.equal(f.issue().fields.status.id, "3");
  assert.ok((await f.operations(["audit"])).every(e => e.publication_status === "SYNCED"));
  assert.ok(f.envelopes.some(e => e.method === "tools/call" && e.params.name === "createConfluenceContent"));
  assert.ok(f.envelopes.some(e => e.method === "tools/call" && e.params.name === "getJiraIssue"));
  f.history(["review", "--project", "demo", "--request", "work", "--ticket", "feature", "--fingerprint", "verified", "--result", "accepted", "--reason", "accepted"]);
  f.setFailure("lost"); const result = await f.operations(["flush", "--request", "work"]);
  assert.ok(result.deferred.length > 0); const count = f.posts(); f.setFailure(null);
  await f.operations(["flush", "--request", "work"]); assert.equal(f.posts(), count);
  const entries = (await f.atlassian(["status"])).entries;
  assert.ok(entries.some(e => e.status === "NEEDS_RECONCILIATION"));
  f.config.mcp.bindings["jira.getIssue"].arguments.extra = "new binding"; f.saveConfig();
  assert.throws(() => requireConsent(f.root, "demo", f.env), /stale/);
});

test("missing MCP write binding leaves outbox pending rather than claiming an uncertain submitted write", async t => {
  const f = fixture(t, true); delete f.config.mcp.bindings["jira.createIssue"]; f.saveConfig(); await f.grant();
  const result = await f.operations(["flush", "--request", "work"]);
  assert.equal(result.recorded, 0); assert.equal(result.deferred.length, 1); assert.equal(f.posts(), 0);
  assert.equal((await f.atlassian(["status"])).entries[0].status, "PENDING");
});

test("one scoped approval enables ticket publication and linking without approving development or Git", async t => {
  const f = fixture(t);
  assert.equal((await f.operations(["flush", "--request", "work"])).skipped, 1); assert.equal(f.posts(), 0);
  await assert.rejects(f.atlassian(["consent", "grant", "--project", "demo", "--approve", "invalid"]), /scope-digest/);
  const grant = await f.grant();
  const result = await f.operations(["flush", "--request", "work"]);
  assert.equal(result.recorded, 1); assert.equal(result.deferred.length, 0); assert.equal(f.posts(), 1);
  const plan = f.request(["show", "work"]);
  assert.equal(plan.status, "DRAFT"); assert.equal(plan.tickets[0].source.issue_key, "DEMO-1");
  assert.equal(fs.existsSync(path.join(f.local, "release-approvals")), false);
  const outbox = await f.atlassian(["status"]);
  assert.deepEqual(outbox.entries[0].authorization, { kind: "standing-consent", grant_id: grant.id });
  await f.operations(["flush", "--request", "work"]); assert.equal(f.posts(), 1);
});

test("standing consent drives running, review and accepted publications with no repeated payload approval", async t => {
  const f = fixture(t); await f.grant(); await f.operations(["flush", "--request", "work"]); await f.prepareState("PREPARED");
  const prepared = readJson(f.stateFile); prepared.tickets[0].runner.attempts = 0; writeJsonAtomic(f.stateFile, prepared);
  const messages = [], hook = createPublicationHook({ ...f, log: s => messages.push(s), flush: f.operations });
  const runner = createAgentRunnerCommand({ ...f, onProgress: id => hook("runner", ["run", id]), invokeAgent: async () => {
    assert.equal(f.issue().fields.status.id, "1");
    return "diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n";
  }, notify: async () => ({ sent: 1 }), runGit: () => ({ status: 0 }), runCommand: () => ({ status: 0 }), tokenizeCommand: s => s.split(" ") });
  await runner(["run", "work"]); await hook("runner", ["run", "work"]);
  assert.equal(f.issue().fields.status.id, "3");
  assert.ok((await f.operations(["audit"])).every(e => e.publication_status === "SYNCED"));
  f.history(["review", "--project", "demo", "--request", "work", "--ticket", "feature", "--fingerprint", "verified", "--result", "accepted", "--reason", "user acceptance"]);
  await hook("history", ["review", "--request", "work"]); assert.equal(f.issue().fields.status.id, "4");
  const count = f.posts(); await hook("runner", ["run", "work"]); await hook("history", ["list"]); assert.equal(f.posts(), count);
  assert.ok(messages.some(s => s.includes("standing consent")));
  assert.equal(readJson(f.stateFile).tickets[0].runner.attempts, 1);
});

test("revocation, changed destinations, principals and mappings invalidate consent without POST", async t => {
  const f = fixture(t); const grant = await f.grant();
  assert.equal((await f.atlassian(["consent", "status", "--project", "demo"])).length, 1);
  f.config.confluence_projects.demo.parent_id = "99"; f.saveConfig();
  assert.throws(() => requireConsent(f.root, "demo", f.env), /stale/);
  assert.equal((await f.operations(["flush", "--request", "work"])).recorded, 0);
  f.config.confluence_projects.demo.parent_id = "11"; f.saveConfig();
  assert.throws(() => requireConsent(f.root, "demo", { ...f.env, ATLASSIAN_EMAIL: "another@example.com" }), /stale/);
  f.config.workflow_statuses.demo.REVIEW_READY = "4"; f.saveConfig();
  assert.throws(() => requireConsent(f.root, "demo", f.env), /stale/);
  f.config.workflow_statuses.demo.REVIEW_READY = "3"; f.saveConfig();
  await f.atlassian(["consent", "revoke", "--project", "demo"]);
  await f.atlassian(["queue-ticket", "work", "--ticket", "feature"]);
  const entry = (await f.atlassian(["status"])).entries[0];
  await assert.rejects(f.atlassian(["sync", "--project", "demo", "--entry", entry.id, "--consent", grant.id]), /revoked/);
  assert.equal(f.posts(), 0);
  const renewed = await f.grant(); assert.notEqual(renewed.id, grant.id);
  assert.throws(() => requireConsent(f.root, "demo", f.env, grant.id), /stale/);
});

test("consent excludes arbitrary pages, altered payloads and stale ticket plans", async t => {
  const f = fixture(t), grant = await f.grant();
  const file = path.join(f.root, "custom.json"); writeJsonAtomic(file, { title: "Manual page", summary: "Needs payload approval", request_id: "work", ticket_id: "feature" });
  const manual = await f.atlassian(["queue-result", "--project", "demo", "--file", file]);
  await assert.rejects(f.atlassian(["sync", "--project", "demo", "--entry", manual.id, "--consent", grant.id]), /arbitrary/);
  const entry = await f.atlassian(["queue-ticket", "work", "--ticket", "feature"]);
  assert.throws(() => assertConsentedEntry(f.root, { ...entry, payload: { ...entry.payload, fields: { ...entry.payload.fields, summary: "tampered" } } }, f.env), /Noncanonical/);
  assert.throws(() => assertConsentedEntry(f.root, { ...entry, connection: { site: "https://other.atlassian.net", cloud_id: null } }, f.env), /destination/);
  f.request(["priority", "work", "--ticket", "feature", "--value", "P1"]);
  await assert.rejects(f.atlassian(["sync", "--project", "demo", "--entry", entry.id, "--consent", grant.id]), /changed since/);
  assert.equal(f.posts(), 0);
});

test("offline and uncertain publication do not retry implementation or blind POST on reentry", async t => {
  const f = fixture(t); await f.grant();
  f.env.HARNESS_OFFLINE = "true";
  assert.equal((await f.operations(["flush", "--request", "work"])).offline, true); assert.equal(f.posts(), 0);
  delete f.env.HARNESS_OFFLINE;
  f.setFailure("lost"); assert.equal((await f.operations(["flush", "--request", "work"])).deferred.length, 1);
  const count = f.posts(); f.setFailure(null);
  assert.equal((await f.operations(["flush", "--request", "work"])).deferred.length, 1); assert.equal(f.posts(), count);
  assert.equal(f.request(["show", "work"]).status, "DRAFT");
  assert.equal((await f.atlassian(["status"])).entries[0].status, "NEEDS_RECONCILIATION");
});

test("consent is rechecked after awaited remote checks and newer states wait for uncertain transitions", async t => {
  const f = fixture(t); await f.grant(); await f.operations(["flush", "--request", "work"]); await f.prepareState("RUNNING");
  const intent = (await f.operations(["audit"]))[0]; await f.operations(["prepare", intent.id]);
  const entry = (await f.atlassian(["status"])).entries.find(e => e.status === "PENDING");
  const grant = requireConsent(f.root, "demo", f.env), count = f.posts();
  const revokedDuringGet = createAtlassianCommand({ ...f, fetchImpl: async (url, init) => {
    const response = await f.fetchImpl(url, init);
    if (init.method === "GET") await f.atlassian(["consent", "revoke", "--project", "demo"]);
    return response;
  } });
  await assert.rejects(revokedDuringGet(["sync", "--project", "demo", "--entry", entry.id, "--consent", grant.id]), /incomplete/);
  assert.equal(f.posts(), count);
  await f.grant(); await f.atlassian(["retry-rejected", entry.id, "--approve", entry.id]); f.setFailure("lost");
  await f.operations(["flush", "--request", "work"]); const uncertainCount = f.posts(); f.setFailure(null);
  const state = readJson(f.stateFile); state.tickets[0].status = "BLOCKED"; writeJsonAtomic(f.stateFile, state);
  const next = await f.operations(["flush", "--request", "work"]);
  assert.ok(next.deferred.length > 0); assert.equal(f.issue().fields.status.id, "0");
  assert.equal(f.posts(), uncertainCount + 1); // a distinct result page, not another status transition
});

test("read-only commands never deliver, project isolation holds and warnings do not replace development outcome", async t => {
  const f = fixture(t); await f.grant();
  const messages = [], hook = createPublicationHook({ ...f, log: s => messages.push(s), flush: f.operations });
  await hook("request", ["show", "work"]); await hook("atlassian", ["search", "--project", "demo"]);
  await f.operations(["flush", "--request", "work", "--project", "other"]); assert.equal(f.posts(), 0);
  f.setFailure(429); await hook("request", ["create", "work"]); assert.ok(messages.some(s => s.includes("pending inspection")));
  const count = f.posts(); await hook("request", ["create", "work"]); assert.equal(f.posts(), count);
  const brokenHook = createPublicationHook({ ...f, log: s => messages.push(s), flush: async () => { throw new Error("disk unavailable"); } });
  await brokenHook("runner", ["run", "work"]); assert.ok(messages.some(s => s.includes("outcome unchanged")));
});

test("standing result and status scope rejects tampering and rechecks remote workflow categories", async t => {
  const f = fixture(t); const grant = await f.grant(); await f.operations(["flush", "--request", "work"]); await f.prepareState();
  const intents = await f.operations(["audit"]);
  const result = await f.operations(["prepare", intents.find(e => e.kind === "confluence-result").id]);
  assert.throws(() => assertConsentedEntry(f.root, { ...result, payload: { ...result.payload, parentId: "999" } }, f.env, f.reviewFingerprint), /Noncanonical/);
  const transition = await f.operations(["prepare", intents.find(e => e.kind === "jira-status").id]);
  assert.throws(() => assertConsentedEntry(f.root, { ...transition, transition: { ...transition.transition, to_status: "4" } }, f.env, f.reviewFingerprint), /Noncanonical/);
  const count = f.posts(), changedWorkflow = createAtlassianCommand({ ...f, fetchImpl: async (url, init) =>
    url.endsWith("/status/3") ? new globalThis.Response('{"id":"3","statusCategory":{"key":"done"}}') : f.fetchImpl(url, init) });
  await assert.rejects(changedWorkflow(["sync", "--project", "demo", "--entry", transition.id, "--consent", grant.id]), /incomplete/);
  assert.equal(f.posts(), count);
  f.setLive("modified");
  await assert.rejects(f.atlassian(["sync", "--project", "demo", "--entry", result.id, "--consent", grant.id]), /files changed/);
});

test("link refuses local edits or remotely changed content instead of silently retaining a stale plan", async t => {
  const f = fixture(t); await f.atlassian(["queue-ticket", "work", "--ticket", "feature"]); await f.publish();
  f.issue().fields.summary = "remote edit";
  await assert.rejects(f.atlassian(["link", "work", "--ticket", "feature"]), /content\/priority changed/);
  f.request(["priority", "work", "--ticket", "feature", "--value", "P1"]);
  await assert.rejects(f.atlassian(["link", "work", "--ticket", "feature"]), /Local ticket/);
});

test("result capture, annotation, prepare, approval and retry are idempotent without development calls", async t => {
  const f = fixture(t); await f.link(); await f.prepareState();
  const entries = await f.operations(["repair"]), result = entries.find(e => e.kind === "confluence-result"), status = entries.find(e => e.kind === "jira-status");
  assert.equal(result.publication_status, "MISSING");
  const note = path.join(f.root, "note.json"); writeJsonAtomic(note, { before: "zero allowed", after: "zero rejected", rationale: "business rule", context_changes: "positive values only" });
  await f.operations(["annotate", result.id, "--file", note]);
  const count = f.posts(); const queued = await f.operations(["prepare", result.id]); await f.operations(["prepare", result.id]);
  await f.operations(["prepare", status.id]); assert.equal(f.posts(), count);
  assert.doesNotMatch(queued.payload.body.value, /secret-value|--token/); assert.match(queued.payload.body.value, /positive values only/);
  await assert.rejects(f.operations(["annotate", result.id, "--file", note]), /Already prepared/);
  f.setFailure(429); await assert.rejects(f.publish(), /incomplete/);
  const failed = await f.operations(["audit"]); assert.ok(failed.every(e => e.publication_status === "REJECTED"));
  for (const item of failed) await f.atlassian(["retry-rejected", item.outbox_id, "--approve", item.outbox_id]);
  f.setFailure(null); await f.publish();
  assert.ok((await f.operations(["audit"])).every(e => e.publication_status === "SYNCED"));
  const after = f.posts(); await f.operations(["repair"]); await f.operations(["prepare", result.id]); assert.equal(f.posts(), after);
  assert.equal(readJson(f.stateFile).tickets[0].runner.attempts, 1);
});

test("review is not Done; acceptance creates new intents and invalidates old queued approvals", async t => {
  const f = fixture(t); await f.link(); await f.prepareState();
  const old = (await f.operations(["repair"])).find(e => e.kind === "jira-status");
  await f.operations(["prepare", old.id]); const preview = await f.atlassian(["preview"]);
  f.history(["review", "--project", "demo", "--request", "work", "--ticket", "feature", "--fingerprint", "verified", "--result", "accepted", "--reason", "user accepted"]);
  await assert.rejects(f.atlassian(["sync", "--approve", preview.approval_digest]), /evidence changed|superseded/);
  const current = await f.operations(["audit"]); assert.ok(current.every(e => e.fact.status === "COMPLETED"));
  await f.atlassian(["preview"]); // retires the obsolete PENDING draft
  const done = current.find(e => e.kind === "jira-status"); await f.operations(["prepare", done.id]); await f.publish();
  assert.equal(f.issue().fields.status.id, "4");
  const reentered = createFollowupCommand({ ...f, atlassian: f.atlassian });
  assert.equal((await reentered(["audit"])).find(e => e.kind === "jira-status").publication_status, "SYNCED");
});

test("content drift and destination changes refuse stale publication; already-target state uses GET only", async t => {
  const f = fixture(t); await f.link(); await f.prepareState();
  const entries = await f.operations(["repair"]), result = entries.find(e => e.kind === "confluence-result"), status = entries.find(e => e.kind === "jira-status");
  await f.operations(["prepare", result.id]); const preview = await f.atlassian(["preview"]), count = f.posts();
  f.setLive("changed"); await assert.rejects(f.atlassian(["sync", "--approve", preview.approval_digest]), /files changed/); assert.equal(f.posts(), count);
  f.setLive("verified"); f.config.confluence_projects.demo.parent_id = "99"; f.saveConfig();
  await assert.rejects(f.atlassian(["sync", "--approve", preview.approval_digest]), /destination or draft changed/);
  f.issue().fields.status.id = "3";
  await f.operations(["prepare", status.id]); assert.equal(f.posts(), count);
  assert.equal((await f.operations(["audit"])).find(e => e.kind === "jira-status").publication_status, "SYNCED");
});

test("uncertain posts are not retried by repair; missing intent storage is reconstructed", async t => {
  const f = fixture(t); await f.link(); await f.prepareState();
  const result = (await f.operations(["repair"])).find(e => e.kind === "confluence-result"); await f.operations(["prepare", result.id]);
  f.setFailure("lost"); await assert.rejects(f.publish(), /incomplete/); const count = f.posts();
  fs.rmSync(path.join(f.local, "followups.json"));
  const repaired = (await f.operations(["repair"])).find(e => e.kind === "confluence-result");
  assert.equal(repaired.publication_status, "NEEDS_RECONCILIATION"); await f.operations(["prepare", repaired.id]); assert.equal(f.posts(), count);
});

test("workflow mapping rejects Done for review; runner automatically captures running and terminal facts", async t => {
  const f = fixture(t); await f.link();
  assert.equal((await f.atlassian(["workflow", "--project", "demo"]))[0].statuses[0].id, "3");
  await assert.rejects(f.atlassian(["workflow", "--project", "demo", "--running", "1", "--blocked", "2", "--review-ready", "4", "--completed", "3"]), /Done category/);
  await f.atlassian(["workflow", "--project", "demo", "--running", "1", "--blocked", "2", "--review-ready", "3", "--completed", "4"]);
  await f.prepareState("PREPARED");
  const runner = createAgentRunnerCommand({ ...f, invokeAgent: async () => {
    assert.equal(readJson(path.join(f.local, "followups.json")).entries[0].fact.status, "RUNNING");
    return "diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n";
  }, notify: async () => ({ sent: 1 }), runGit: () => ({ status: 0 }), runCommand: () => ({ status: 0 }), tokenizeCommand: s => s.split(" ") });
  await runner(["run", "work"]);
  assert.ok(readJson(path.join(f.local, "followups.json")).entries.some(e => e.fact.status === "REVIEW_READY"));
  fs.writeFileSync(path.join(f.local, "followups.json"), "broken"); const warnings = [];
  safeCaptureFollowups(f.root, message => warnings.push(message)); assert.equal(warnings.length, 1);
  fs.rmSync(path.join(f.local, "followups.json")); assert.ok(captureFollowups(f.root).entries.length > 0);
});

test("changed Jira inputs reject queued follow-up before POST and changes-requested is not completed", async t => {
  const f = fixture(t); await f.link(); await f.prepareState();
  const result = (await f.operations(["repair"])).find(e => e.kind === "confluence-result");
  await f.operations(["prepare", result.id]); const count = f.posts();
  f.issue().fields.summary = "requirement changed after preparation";
  await assert.rejects(f.publish(), /incomplete/); assert.equal(f.posts(), count);
  assert.equal((await f.operations(["audit"])).find(e => e.id === result.id).publication_status, "REJECTED");
  f.history(["review", "--project", "demo", "--request", "work", "--ticket", "feature", "--fingerprint", "verified", "--result", "changes-requested", "--reason", "needs correction"]);
  assert.ok((await f.operations(["audit"])).every(e => e.fact.status === "CHANGES_REQUESTED"));
});
