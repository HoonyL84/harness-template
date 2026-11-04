"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { createRequestCommand, readPlan } = require("../../tools/harness-cli/request-command");
const { createPlanningEvalCommand, grade } = require("../../tools/harness-cli/planning-eval");
const { captureInput, validateOutput, safeFile, assertFreshInput } = require("../../tools/harness-cli/planning-contract");
const { createAtlassianCommand } = require("../../tools/harness-cli/atlassian-command");
const { writeJsonAtomic } = require("../../tools/harness-cli/control-plane-state");
const { createSnapshot } = require("../../tools/harness-cli/backup-command");
const { approveOnboardingProfile, createOnboardingProfile, writeOnboardingProfile } = require("../../tools/harness-cli/project-onboarding");
const { emptyRegistry, writeRegistry } = require("../../tools/harness-cli/project-registry");

const repository = path.resolve(__dirname, "../..");
function parseArgs(args) {
  const positional = [], options = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) positional.push(args[i]);
    else options[args[i].slice(2)] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
  }
  return { positional, options };
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-planning-")), projectPath = path.join(root, "project");
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(projectPath, "docs"), { recursive: true });
  fs.writeFileSync(path.join(projectPath, "docs/rules.md"), "# Rules\nPreserve user data.\n");
  fs.mkdirSync(path.join(root, "prompts/templates"), { recursive: true });
  fs.copyFileSync(path.join(repository, "prompts/templates/planning-quality.md"), path.join(root, "prompts/templates/planning-quality.md"));
  const project = { id: "demo", path: projectPath };
  const diagnosis = { path: projectPath, head: "abc", branch: "main", dirty: false, changed_paths: 0, worktree_fingerprint: "clean", remotes: {}, stacks: ["node"], verify_commands: ["node --test"] };
  const draft = createOnboardingProfile(project, diagnosis, [], []), profile = approveOnboardingProfile(draft, draft);
  writeOnboardingProfile(path.join(root, ".harness/local/profiles/demo.json"), profile);
  const registry = emptyRegistry(); registry.projects.demo = project;
  writeRegistry(path.join(root, ".harness/local/projects.json"), registry);
  const specification = { request: "Add a regression test.", projects: ["demo"], sources: [{ source_id: "rules", project_id: "demo", path: "docs/rules.md", start_line: 2, end_line: 2 }] };
  const file = (name, value) => { const p = path.join(root, name); fs.writeFileSync(p, JSON.stringify(value)); return p; };
  return { root, projectPath, specification, file };
}
function outputFor(input, blocking = false) {
  const ids = Object.keys(input.projects);
  return { plan: { goal: input.request, assumptions: [], exclusions: [], tickets: ids.map((id, i) => ({ ticket_id: `task-${i}`, project_id: id, ticket_kind: "development", labels: ["regression"], goal: "Add regression coverage", priority: "P2", risk: "medium", risk_reason: "Existing behavior must not change", scope: ["test"], exclusions: [], acceptance_criteria: ["Existing behavior preserved"], implementation_steps: ["Add regression assertion"], test_plan: { unit: ["Check preservation"], integration: [], regression: [], manual: [] }, verification: [...input.projects[id].verify_commands], depends_on: [] })) },
    facts: input.sources.map(s => ({ ticket_id: `task-${ids.indexOf(s.project_id)}`, source_id: s.source_id, start_line: s.start_line, end_line: s.end_line, quote: s.content, statement: "Read the provided rule" })),
    proposals: ids.map((_, i) => ({ ticket_id: `task-${i}`, request_quote: input.request, statement: "Add tests as a new change" })),
    questions: blocking ? [{ id: "clarify", ticket_ids: ["task-0"], blocking: true, question: "Provide missing rules" }] : [],
    paths: [{ ticket_id: "task-0", path: "tests/new.test.js", kind: "new" }], relations: [] };
}

test("quality capture, draft, human revision and approval preserve immutable evidence", async t => {
  const { root, specification, file } = fixture(t);
  const command = createRequestCommand({ root, parseArgs, log: () => {} });
  const captured = await command(["capture", "work", "--input-file", file("input.json", specification)]);
  assert.equal(captured.api_calls, 0);
  const output = outputFor(captured.input);
  const draft = await command(["draft", "work", "--output-file", file("output.json", output)]);
  assert.equal(draft.ready, true);
  assert.equal(readPlan(path.join(root, ".harness/local/requests/work.json")).status, "DRAFT");
  assert.throws(() => command(["priority", "work", "--ticket", "task-0", "--value", "P1"]), /revalidated/);
  const review = { fingerprint: draft.evidence.fingerprint, result: "changes-requested", reason: "Add boundary coverage", minutes: 2,
    tickets: [{ ticket_id: "task-0", required_total: 3, omissions: 1, claims_total: 1, unsupported_claims: 0, boundary_total: 0, boundary_correct: 0, unnecessary_questions: 0, content_edits: 1 }] };
  const recorded = await command(["planning-review", "work", "--review-file", file("review.json", review)]);
  assert.equal(recorded.metrics.omission_rate, 1 / 3);
  assert.equal(recorded.metrics.boundary_compliance, null);
  assert.equal(recorded.evidence_fingerprint, draft.evidence.fingerprint);
  await assert.rejects(command(["planning-review", "work", "--review-file", file("review.json", { ...review, id: "input-work" })]), /Invalid/);
  output.plan.tickets[0].test_plan.unit.push("Check boundary");
  const revised = await command(["draft", "work", "--output-file", file("output.json", output)]);
  assert.notEqual(revised.evidence.fingerprint, draft.evidence.fingerprint);
  await assert.rejects(command(["planning-review", "work", "--review-file", file("review.json", review)]), /stale/);
  const inspection = await command(["planning", "work"]);
  assert.deepEqual(inspection.evidence.previous_evidence, draft.evidence);
  assert.equal(inspection.reviews.length, 1);
  assert.equal(command(["approve", "work"]).status, "APPROVED");
  assert.doesNotThrow(() => command(["ready", "work"]));
  const backup = createSnapshot(root);
  assert.ok(backup.entries.some(e => e.path === `.harness/local/planning/${draft.evidence.id}.json`));
  assert.ok(backup.entries.some(e => e.path === `.harness/local/planning/${recorded.id}.json`));
  assert.ok(backup.entries.some(e => e.path === ".harness/local/planning/input-work.json"));
});

test("blocking questions, stale sources, changed output and missing evidence cannot pass approval", async t => {
  for (const mode of ["blocking", "stale", "tamper", "missing", "profile", "prompt"]) {
    const { root, projectPath, specification, file } = fixture(t);
    const command = createRequestCommand({ root, parseArgs, log: () => {} });
    const captured = await command(["capture", "work", "--input-file", file("input.json", specification)]);
    const draft = await command(["draft", "work", "--output-file", file("output.json", outputFor(captured.input, mode === "blocking"))]);
    const artifact = path.join(root, ".harness/local/planning", draft.evidence.id + ".json");
    if (mode === "stale") fs.appendFileSync(path.join(projectPath, "docs/rules.md"), "Changed\n");
    if (mode === "tamper") { const v = JSON.parse(fs.readFileSync(artifact)); v.output.facts[0].statement = "changed"; fs.writeFileSync(artifact, JSON.stringify(v)); }
    if (mode === "missing") fs.unlinkSync(artifact);
    if (mode === "prompt") fs.appendFileSync(path.join(root, "prompts/templates/planning-quality.md"), "Changed prompt");
    if (mode === "profile") { const p = path.join(root, ".harness/local/profiles/demo.json"); const v = JSON.parse(fs.readFileSync(p)); v.verify_commands = ["echo bypass"]; fs.writeFileSync(p, JSON.stringify(v)); }
    assert.throws(() => command(["approve", "work"]));
  }
});

test("planning rejects fake references, commands, path escapes, secrets, malformed output and field overrides", t => {
  const { root, projectPath, specification } = fixture(t);
  const input = captureInput(root, specification);
  for (const mutate of [o => o.facts[0].quote = "invented", o => o.facts[0].start_line = 0, o => o.proposals[0].request_quote = "invented", o => o.paths[0].kind = "existing",
    o => o.plan.tickets[0].verification = ["git push"], o => o.paths[0].path = "../escape.js", o => o.plan.requestId = "override", o => o.plan.tickets[0].risk = "unknown",
    o => o.questions = [{ id: "q", blocking: true, ticket_ids: ["unknown"], question: "Q" }], o => o.relations = [{ from: "task-0", to: "task-0", kind: "related" }]]) {
    const output = outputFor(input); mutate(output); assert.throws(() => validateOutput(input, output));
  }
  assert.equal(validateOutput(input, outputFor(input)).ready, true);
  assert.throws(() => safeFile(projectPath, "../escape.md"), /Unsafe/);
  assert.throws(() => safeFile(projectPath, "CON.md"), /Unsafe/);
  assert.throws(() => captureInput(root, { ...specification, request: "api_key=" + "x".repeat(32) }), /secret/);
  assert.throws(() => captureInput(root, { ...specification, request: JSON.stringify({ api_key: "x".repeat(32) }) }), /secret/);
  assert.throws(() => safeFile(projectPath, "credentials.json", false), /Unsafe/);
  assert.throws(() => captureInput(root, { ...specification, sources: [{ source_id: "not-docs", project_id: "demo", path: "notes.md" }] }), /Context path/);
  assert.throws(() => captureInput(root, { ...specification, request: "x".repeat(100000) }), /96KB/);
  const missing = captureInput(root, { ...specification, missing_context: ["rules"] });
  assert.equal(validateOutput(missing, outputFor(missing)).ready, false);
});

test("planning Confluence capture binds configured cached page identity, version, age and bytes", t => {
  const { root, specification } = fixture(t);
  const config = { site: "https://example.atlassian.net", jira_projects: { demo: "DEMO" }, confluence_projects: { demo: { space_id: "12", context_page_ids: ["34"] } } };
  const cache = { project_id: "demo", site: config.site, space_id: "12", cloud_id: null, fetched_at: new Date().toISOString(), pages: [{ id: "34", version: 1, content: "Approved rule" }] };
  const cacheFile = path.join(root, ".harness/local/remote-context/demo.json");
  writeJsonAtomic(path.join(root, ".harness/local/atlassian.json"), config);
  writeJsonAtomic(cacheFile, cache);
  const spec = { ...specification, sources: [{ source_id: "remote", project_id: "demo", page_id: "34", version: 1, max_age_minutes: 60 }] };
  const input = captureInput(root, spec);
  assert.equal(input.sources[0].content, "Approved rule");
  assert.doesNotThrow(() => assertFreshInput(root, input));
  for (const altered of [{ ...cache, site: "https://other.atlassian.net" }, { ...cache, fetched_at: "2000-01-01" }, { ...cache, pages: [{ ...cache.pages[0], version: 2 }] }]) {
    writeJsonAtomic(cacheFile, altered); assert.throws(() => captureInput(root, spec));
  }
  writeJsonAtomic(cacheFile, { ...cache, pages: [{ ...cache.pages[0], content: "Changed rule" }] });
  assert.throws(() => assertFreshInput(root, input), /changed/);
});

test("Git dependencies must be disclosed, acyclic and distinct from document relationships", t => {
  const { root, specification } = fixture(t), input = captureInput(root, specification);
  const output = outputFor(input);
  output.plan.tickets.push({ ...output.plan.tickets[0], ticket_id: "task-1", depends_on: ["task-0"] });
  output.proposals.push({ ...output.proposals[0], ticket_id: "task-1" });
  assert.throws(() => validateOutput(input, output), /disclosed/);
  output.relations.push({ from: "task-0", to: "task-1", kind: "git_dependency" });
  assert.equal(validateOutput(input, output).ready, true);
  output.plan.tickets[0].depends_on = ["task-1"];
  assert.throws(() => validateOutput(input, output), /cycle/);
  output.plan.tickets.forEach(t => { t.depends_on = []; });
  output.relations[0].kind = "document";
  assert.equal(validateOutput(input, output).ready, true);
});

test("quality draft survives existing Jira publication/link and keeps old evidence (mock transport only)", async t => {
  const { root, specification, file } = fixture(t);
  const command = createRequestCommand({ root, parseArgs, log: () => {} });
  const input = await command(["capture", "work", "--input-file", file("input.json", specification)]);
  const draft = await command(["draft", "work", "--output-file", file("output.json", outputFor(input.input))]);
  writeJsonAtomic(path.join(root, ".harness/local/atlassian.json"), { transport: "rest", site: "https://example.atlassian.net", jira_projects: { demo: "DEMO" }, jira_issue_types: { demo: "10001" } });
  let fields, calls = 0;
  const atlassian = createAtlassianCommand({ root, parseArgs, log: () => {}, env: { ATLASSIAN_EMAIL: "test@example.org", ATLASSIAN_API_TOKEN: "fake" }, fetchImpl: async (_url, init) => {
    calls++;
    if (init.method === "POST") fields = JSON.parse(init.body).fields;
    return new globalThis.Response(JSON.stringify({ id: "123", key: "DEMO-1", fields: { ...fields, project: { key: "DEMO" }, updated: "2026-01-01" } }));
  } });
  await atlassian(["queue-ticket", "work", "--ticket", "task-0"]);
  assert.equal(calls, 0);
  const preview = await atlassian(["preview"]);
  await atlassian(["sync", "--approve", preview.approval_digest]);
  const linked = await atlassian(["link", "work", "--ticket", "task-0"]);
  assert.equal(linked.status, "DRAFT");
  assert.notEqual(linked.planning_evidence.fingerprint, draft.evidence.fingerprint);
  assert.equal(readPlan(path.join(root, ".harness/local/requests/work.json")).tickets[0].source.issue_key, "DEMO-1");
  assert.deepEqual((await command(["planning", "work"])).evidence.previous_evidence, draft.evidence);
  assert.equal(calls, 2);
});

test("planning rejects source and state junctions without touching their targets", async t => {
  const { root, projectPath, specification, file } = fixture(t);
  fs.symlinkSync(path.join(projectPath, "docs"), path.join(projectPath, "docs/linked"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => captureInput(root, { ...specification, sources: [{ source_id: "bad", project_id: "demo", path: "docs/linked/rules.md" }] }), /symlink/);
  fs.symlinkSync(projectPath, path.join(root, ".harness/local/planning"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(createRequestCommand({ root, parseArgs, log: () => {} })(["capture", "work", "--input-file", file("input.json", specification)]), /symlink/);
  assert.equal(fs.existsSync(path.join(projectPath, "input-work.json")), false);
});

test("API generation is opt-in, bounded, recorded and uses the same output validator for three providers", async t => {
  for (const provider of ["openai", "anthropic", "gemini"]) {
    const { root, specification, file } = fixture(t);
    let calls = 0;
    const command = createRequestCommand({ root, parseArgs, log: () => {}, env: { HARNESS_AGENT_MODE: "api" }, invokeAgent: async args => {
      calls++; assert.equal(args.maxRequests, 1); assert.equal(args.maxOutputTokens, 4096);
      assert.match(args.systemPrompt, /Grounded planning/);
      assert.equal(JSON.parse(args.prompt).prompt_template, undefined);
      return { text: JSON.stringify(outputFor(JSON.parse(args.prompt))), response: {} };
    } });
    const captured = await command(["capture", "work", "--input-file", file("input.json", specification)]);
    assert.equal((await command(["generate", "work", "--provider", provider])).api_calls, 0);
    await assert.rejects(command(["generate", "work", "--provider", provider, "--live"]), /requires/);
    assert.equal(calls, 0);
    const result = await command(["generate", "work", "--provider", provider, "--live", "--approve-send", "--max-requests", "1", "--input-fingerprint", captured.input_fingerprint]);
    assert.equal(calls, 1); assert.equal(result.ready, true);
    const record = await command(["planning", "work"]);
    assert.equal(record.evidence.provenance, "provider-api");
    assert.equal(record.evidence.usage.total_tokens, null);
  }
});

test("API errors, invalid JSON and high-risk fast conflict never execute or silently retry", async t => {
  for (const mode of ["timeout", "quota", "bad-json", "oversize", "high"]) {
    const { root, specification, file } = fixture(t);
    let calls = 0;
    const command = createRequestCommand({ root, parseArgs, log: () => {}, env: { HARNESS_AGENT_MODE: "api" }, invokeAgent: async () => {
      calls++;
      if (["quota", "timeout"].includes(mode)) throw new Error(mode);
      return { text: mode === "oversize" ? "x".repeat(100000) : "not JSON", response: {} };
    } });
    const captured = await command(["capture", "work", "--input-file", file("input.json", { ...specification, risk: mode === "high" ? "high" : "medium" })]);
    await assert.rejects(command(["generate", "work", "--provider", "openai", "--model-tier", mode === "high" ? "fast" : "standard", "--live", "--approve-send", "--max-requests", "1", "--input-fingerprint", captured.input_fingerprint]));
    assert.equal(calls, mode === "high" ? 0 : 1);
    assert.equal(fs.existsSync(path.join(root, ".harness/local/requests/work.json")), false);
  }
});

test("planning eval reuses offline import, bounded live engine, comparison and human review", async t => {
  const { root, file } = fixture(t);
  fs.mkdirSync(path.join(root, "evals/regression"), { recursive: true });
  fs.copyFileSync(path.join(repository, "evals/regression/planning-quality-cases.json"), path.join(root, "evals/regression/planning-quality-cases.json"));
  let calls = 0;
  const command = createPlanningEvalCommand({ root, parseArgs, log: () => {}, env: { HARNESS_AGENT_MODE: "api" }, invokeAgent: async args => {
    calls++; assert.ok(!args.prompt.includes('"rubric"'));
    const input = JSON.parse(args.prompt);
    return { text: JSON.stringify(outputFor(input, input.missing_context.length > 0 || input.request.includes("age targeting"))), response: {} };
  } });
  const bank = await command(["list"]);
  assert.equal(bank.cases.length, 6);
  const rows = bank.cases.map(c => ({ id: c.id, text: JSON.stringify(outputFor(JSON.parse(c.input), !c.expected.ready)) }));
  const first = await command(["import", "--responses-file", file("responses.json", rows)]);
  assert.equal(first.passed, 6); assert.equal(calls, 0); assert.equal(first.observed_total_tokens, null);
  assert.equal(first.latency_ms, null);
  assert.ok((await command(["show", first.id])).cases[0].rubric.required.length);
  const second = await command(["import", "--responses-file", file("responses.json", rows)]);
  assert.equal((await command(["compare", first.id, second.id])).runs.length, 2);
  const review = await command(["review", first.id, "--fingerprint", first.result_fingerprint, "--result", "accepted", "--reason", "Fixture structural acceptance only", "--minutes", "2"]);
  assert.equal(review.human_review, "accepted");
  const preview = await command(["run", "--provider", "openai", "--model", "test-model"]);
  assert.equal(preview.api_calls, 0); assert.equal(preview.cases.length, 3);
  const live = await command(["run", "--provider", "openai", "--model", "test-model", "--cases", bank.cases.map(c => c.id).join(","), "--live", "--max-requests", "6"]);
  assert.equal(calls, 6); assert.equal(live.passed, 6);
  await assert.rejects(command(["compare", live.id, first.id]), /identical/);
  assert.equal(grade(bank.cases[0], "bad JSON").passed, false);
  // A semantically bad but well-formed statement is deliberately left to human review.
  const semantic = outputFor(JSON.parse(bank.cases[0].input)); semantic.facts[0].statement = "A misleading interpretation";
  assert.equal(grade(bank.cases[0], JSON.stringify(semantic)).passed, true);
  const changed = JSON.parse(fs.readFileSync(path.join(root, "evals/regression/planning-quality-cases.json")));
  changed.cases[0].rubric.required.push("New acceptance rule");
  fs.writeFileSync(path.join(root, "evals/regression/planning-quality-cases.json"), JSON.stringify(changed));
  const third = await command(["import", "--responses-file", file("responses.json", rows)]);
  await assert.rejects(command(["compare", first.id, third.id]), /identical/);
});

test("real CLI exposes planning capture and eval without provider tokens", { skip: Boolean(process.env.NODE_V8_COVERAGE) }, () => {
  const env = { ...process.env, TELEGRAM_BOT_TOKEN: "your_token", TELEGRAM_CHAT_ID: "your_chat", SLACK_WEBHOOK_URL: "example" };
  delete env.NODE_V8_COVERAGE;
  const result = spawnSync(process.execPath, [path.join(repository, "tools/harness-cli/index.js"), "eval", "planning", "list"], { cwd: repository, env, encoding: "utf8", timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).cases.length, 6);
});

test("real CLI completes single/multi-project capture, draft and approval without external effects", { skip: Boolean(process.env.NODE_V8_COVERAGE) }, t => {
  for (const count of [1, 2]) {
    const { root, specification, file } = fixture(t);
    if (count === 2) {
      const project = { id: "second", path: path.join(root, "second") };
      fs.mkdirSync(project.path);
      const diagnosis = { path: project.path, head: "def", branch: "main", dirty: false, changed_paths: 0, worktree_fingerprint: "clean", remotes: {}, stacks: ["node"], verify_commands: ["node --test"] };
      const draft = createOnboardingProfile(project, diagnosis, [], []);
      writeOnboardingProfile(path.join(root, ".harness/local/profiles/second.json"), approveOnboardingProfile(draft, draft));
      const registryPath = path.join(root, ".harness/local/projects.json"), registry = JSON.parse(fs.readFileSync(registryPath));
      registry.projects.second = project; writeRegistry(registryPath, registry);
      specification.projects.push("second");
    }
    fs.cpSync(path.join(repository, "tools"), path.join(root, "tools"), { recursive: true });
    const env = { ...process.env, HARNESS_AGENT_MODE: "interactive", HARNESS_OFFLINE: "true", TELEGRAM_BOT_TOKEN: "your_token", TELEGRAM_CHAT_ID: "your_chat", SLACK_WEBHOOK_URL: "example" };
    delete env.NODE_V8_COVERAGE;
    const run = args => {
      const result = spawnSync(process.execPath, [path.join(root, "tools/harness-cli/index.js"), "request", ...args], { cwd: root, env, encoding: "utf8", timeout: 15000 });
      assert.equal(result.status, 0, result.stderr);
      return result.stdout;
    };
    const captured = JSON.parse(run(["capture", "work", "--input-file", file("input.json", specification)]));
    const drafted = JSON.parse(run(["draft", "work", "--output-file", file("output.json", outputFor(captured.input))]));
    assert.equal(drafted.summary.length, count);
    assert.match(run(["approve", "work"]), /APPROVED/);
    assert.match(run(["ready", "work"]), /READY/);
    assert.equal(JSON.parse(run(["planning", "work"])).plan.status, "APPROVED");
    for (const dir of ["executions", "worktrees"]) assert.equal(fs.existsSync(path.join(root, ".harness/local", dir)), false);
  }
});
