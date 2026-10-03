"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createModelEvalCommand, resultFingerprint } = require("../../tools/harness-cli/model-eval-command");
const { grade, observedUsage } = require("../../tools/harness-cli/model-eval-oracle");
const { requestAgent } = require("../../tools/harness-cli/provider-request");
const bank = require("../../evals/regression/ticket-cases.json").cases;
function parseArgs(args) {
  const positional = [], options = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) positional.push(args[i]);
    else { const key = args[i].slice(2); options[key] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true; }
  }
  return { positional, options };
}
function answer(item) {
  return JSON.stringify({ status: item.expected.status, requires_approval: true, git_actions: [], missing_context: item.expected.missing || [],
    tickets: (item.expected.projects || []).map((project, i) => ({ ticket_id: `ticket-${i}`, project_id: project, goal: "Specific goal",
      scope: ["bounded change"], exclusions: ["no Git release"], acceptance_criteria: ["observable behavior"], implementation_steps: ["inspect then implement"],
      test_plan: { unit: ["test behavior"], integration: [], regression: [], manual: [] }, verification: ["npm test"], depends_on: [] })) });
}
function fixture(t, invoke, env = { HARNESS_AGENT_MODE: "api" }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-model-eval-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "evals/regression"), { recursive: true });
  fs.copyFileSync(path.join(__dirname, "../../evals/regression/ticket-cases.json"), path.join(root, "evals/regression/ticket-cases.json"));
  const output = [], calls = []; let clock = 0;
  const command = createModelEvalCommand({ root, parseArgs, log: v => output.push(JSON.parse(v)), env, now: () => clock += 10,
    invokeAgent: async args => { calls.push(args); return invoke ? invoke(args, calls.length) : { text: answer(bank.find(c => args.prompt.startsWith(c.input))), response: { usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }, response_model: "actual-model" }; } });
  return { root, command, calls, output, file: id => path.join(root, ".harness/local/evals", `${id}.json`) };
}
const run = (model = "example-model", extra = []) => ["run", "--provider", "openai", "--model", model, "--max-requests", "3", ...extra];
function lastRecord(f) { const id = f.output.at(-1).id; return JSON.parse(fs.readFileSync(f.file(id), "utf8")); }

test("eval dry-run and list never request providers or create evidence", async t => {
  const f = fixture(t);
  assert.equal((await f.command(["list"])).cases.length, 3);
  assert.equal((await f.command(run())).api_calls, 0);
  assert.equal(f.calls.length, 0); assert.equal(fs.existsSync(path.join(f.root, ".harness/local")), false);
});
test("live eval requires explicit API mode, supported model and bounded budget", async t => {
  const f = fixture(t, null, {});
  for (const args of [run("x", ["--live"]), ["run", "--live"], run("x", ["--max-attempts", "4"]), run("x", ["--max-requests", "10"]), run("x", ["--cases", "missing-context,missing-context"]), run("x", ["--cases", "unknown"]), run("x", ["--live", "false"]), run("x", ["--typo"]), run("x", ["--max-requests"]), run("x", ["--max-attempts"]), ["run", "--provider", "openai", "--model", "x", "--live"]]) await assert.rejects(f.command(args));
  assert.equal(f.calls.length, 0);
});
test("oracles accept fixed contracts and reject missing context and policy bypass", () => {
  for (const item of bank) assert.equal(grade(item, answer(item)).passed, true);
  assert.equal(grade(bank[0], "no JSON").passed, false);
  assert.equal(grade(bank[0], "null").passed, false);
  const value = JSON.parse(answer(bank[2])); value.requires_approval = false; value.git_actions = ["push"];
  assert.deepEqual(grade(bank[2], JSON.stringify(value)).failures, ["human-approval-required", "no-git-actions"]);
  const missing = JSON.parse(answer(bank[1])); missing.missing_context = [];
  assert.ok(grade(bank[1], JSON.stringify(missing)).failures.includes("required-missing-context"));
  assert.equal(grade(bank[2], "```json\n" + answer(bank[2]) + "\n```").passed, true);
});
test("oracles reject unsafe commands, duplicate IDs, invalid tests and dependency cycles", () => {
  const base = JSON.parse(answer(bank[0]));
  for (const change of [v => { v.tickets[0].verification = ["git push"]; }, v => { v.tickets[1].ticket_id = v.tickets[0].ticket_id; }, v => { v.tickets[0].test_plan = {}; }, v => { v.tickets[0].depends_on = ["ticket-1"]; v.tickets[1].depends_on = ["ticket-0"]; }, v => { v.tickets[0].scope = []; }, v => { v.tickets[0].project_id = "wrong"; }, v => { v.tickets = [null]; }, v => { v.tickets = {}; }, v => { v.missing_context = null; }]) {
    const value = JSON.parse(JSON.stringify(base)); change(value); assert.equal(grade(bank[0], JSON.stringify(value)).passed, false);
  }
});
test("usage distinguishes unknown from zero and records all three provider schemas", () => {
  assert.equal(observedUsage("openai", {}).total_tokens, null);
  assert.equal(observedUsage("openai", { usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 } }).total_tokens, 0);
  assert.equal(observedUsage("openai", { usage: { prompt_tokens: 2, completion_tokens: 3 } }).total_tokens, 5);
  assert.equal(observedUsage("anthropic", { usage: { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 4, cache_creation_input_tokens: 5 } }).total_tokens, 14);
  assert.equal(observedUsage("gemini", { usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 3, totalTokenCount: 10 } }).total_tokens, 10);
  assert.equal(observedUsage("openai", { usage: { prompt_tokens: "2", completion_tokens: -1 } }).total_tokens, null);
});
test("live result binds inputs, actual model, latency and review independently", async t => {
  const f = fixture(t), a = await f.command(run("a", ["--live"]));
  assert.equal(a.passed, 3); assert.equal(a.attempts, 3); assert.equal(a.retries, 0); assert.equal(a.observed_total_tokens, 90);
  assert.equal(a.cost_usd, null); assert.equal(a.human_review, "pending");
  const record = await f.command(["show", a.id]);
  assert.equal(record.cases[0].attempts[0].response_model, "actual-model");
  assert.ok(record.cases[0].attempts[0].prompt_fingerprint); assert.ok(a.latency_ms > 0);
  assert.equal(f.calls[0].maxOutputTokens, 4096); assert.equal(f.calls[0].maxRequests, 3);
  await assert.rejects(f.command(["review", a.id, "--fingerprint", "stale", "--result", "accepted", "--reason", "checked"]));
  const reviewed = await f.command(["review", a.id, "--fingerprint", a.result_fingerprint, "--result", "accepted", "--reason", "manually checked", "--minutes", "5"]);
  assert.equal(reviewed.human_review, "accepted"); assert.equal(reviewed.result_fingerprint, a.result_fingerprint);
  assert.equal(lastRecord(f).review.minutes, 5);
});
test("same cohort compares metrics, different cases or retry policies cannot compare", async t => {
  const f = fixture(t), a = await f.command(run("a", ["--live"])), b = await f.command(run("b", ["--live"]));
  const comparison = await f.command(["compare", a.id + "," + b.id]); assert.equal(comparison.runs.length, 2);
  const c = await f.command(run("c", ["--live", "--cases", "missing-context"]));
  await assert.rejects(f.command(["compare", a.id, c.id]), /identical/);
  const d = await f.command(run("d", ["--live", "--max-attempts", "2"]));
  await assert.rejects(f.command(["compare", a.id, d.id]), /identical/);
  await assert.rejects(f.command(["compare", a.id, a.id]), /unique/);
});
test("structural retry is capped and consumes observations from failed attempts", async t => {
  const f = fixture(t, (args, count) => ({ text: count === 1 ? "wrong" : answer(bank[1]), response: { usage: { total_tokens: 7 } } }));
  const result = await f.command(run("a", ["--live", "--cases", "missing-context", "--max-attempts", "2"]));
  assert.equal(result.retries, 1); assert.equal(result.observed_total_tokens, 14);
  assert.match(f.calls[1].prompt, /Previous structural failures/);
  assert.equal(lastRecord(f).cases[0].attempts[0].oracle.passed, false);
});
test("exhausted budget, repeated failures and API errors never report success", async t => {
  const f = fixture(t);
  await assert.rejects(f.command(run("a", ["--live", "--max-requests", "1"])), /requires review/);
  assert.equal(f.calls.length, 1); assert.equal(lastRecord(f).status, "INCOMPLETE");
  const failed = fixture(t, () => ({ text: "wrong", response: {} }));
  await assert.rejects(failed.command(run("a", ["--live", "--cases", "missing-context", "--max-attempts", "2"])), /requires review/);
  assert.equal(failed.calls.length, 2); assert.equal(lastRecord(failed).status, "COMPLETE"); assert.equal(failed.output.at(-1).observed_total_tokens, null);
  const error = fixture(t, () => { throw new Error("secret credential response"); });
  await assert.rejects(error.command(run("a", ["--live"])), /requires review/);
  assert.equal(error.calls.length, 1); assert.equal(lastRecord(error).status, "INCOMPLETE");
  assert.doesNotMatch(fs.readFileSync(error.file(lastRecord(error).id), "utf8"), /secret credential/);
});
test("evidence is persisted before calls; interrupted or modified runs cannot be compared", async t => {
  let f;
  f = fixture(t, args => {
    const record = fs.readdirSync(path.join(f.root, ".harness/local/evals")).map(file => JSON.parse(fs.readFileSync(path.join(f.root, ".harness/local/evals", file)))).find(r => r.status === "RUNNING");
    assert.equal(record.status, "RUNNING"); assert.equal(record.cases.flatMap(c => c.attempts).find(a => a.status === "STARTED").status, "STARTED");
    return { text: answer(bank.find(c => args.prompt.startsWith(c.input))), response: {} };
  });
  const a = await f.command(run("a", ["--live"])), b = await f.command(run("b", ["--live"]));
  const record = JSON.parse(fs.readFileSync(f.file(a.id))); record.model = "tampered"; fs.writeFileSync(f.file(a.id), JSON.stringify(record));
  await assert.rejects(f.command(["show", a.id]), /changed/);
  record.model = "a"; record.status = "RUNNING"; record.result_fingerprint = resultFingerprint(record); fs.writeFileSync(f.file(a.id), JSON.stringify(record));
  await assert.rejects(f.command(["compare", a.id, b.id]), /completed/);
  await assert.rejects(f.command(["show", "../../outside"]), /ID/);
});
test("oversized output and invalid review options are rejected", async t => {
  const f = fixture(t, () => ({ text: "x".repeat(33000), response: {} }));
  await assert.rejects(f.command(run("x", ["--live", "--cases", "missing-context"])), /requires review/);
  assert.equal(lastRecord(f).cases[0].attempts[0].oracle.failures[0], "output-size-limit");
  const id = f.output.at(-1).id;
  for (const extra of [["--result", "pass"], ["--result", "accepted", "--reason", "x", "--minutes", "-1"]]) await assert.rejects(f.command(["review", id, ...extra]));
});
test("case bank and evidence files reject malformed and oversized content", async t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, "evals/regression/ticket-cases.json"), JSON.stringify({ schema_version: "wrong", cases: bank }));
  await assert.rejects(f.command(["list"]), /Invalid eval/);
  fs.writeFileSync(path.join(f.root, "evals/regression/ticket-cases.json"), "x".repeat(65537));
  await assert.rejects(f.command(["list"]), /64KB/);
});
test("provider transport preserves normal defaults and supports bounded evaluation requests", async () => {
  const env = { OPENAI_API_KEY: "test-openai", ANTHROPIC_API_KEY: "test-anthropic", GEMINI_API_KEY: "test-gemini" };
  for (const provider of ["openai", "anthropic", "gemini"]) {
    for (const cap of [undefined, 4096]) {
      let captured;
      const result = await requestAgent({ provider, model: "example", systemPrompt: "safe", prompt: "case", env, maxOutputTokens: cap,
        postJson: async (url, headers, body) => { captured = { url, headers, body }; return { model: "actual", choices: [{ message: { content: "openai" } }], content: [{ text: "anthropic" }], candidates: [{ content: { parts: [{ text: "gemini" }] } }] }; } });
      assert.equal(result.text, provider); assert.equal(result.response_model, "actual"); assert.doesNotMatch(captured.url, /test-/);
      if (provider === "openai") { assert.equal(captured.body.max_completion_tokens, cap); assert.equal(captured.headers.Authorization, "Bearer test-openai"); }
      if (provider === "anthropic") assert.equal(captured.body.max_tokens, cap || 8192);
      if (provider === "gemini") assert.equal(captured.body.generationConfig?.maxOutputTokens, cap);
    }
  }
  for (const key of [undefined, "your_key", "sk-...", "sk-ant-...", "AIza..."]) await assert.rejects(requestAgent({ provider: "openai", env: { OPENAI_API_KEY: key }, postJson: () => assert.fail("must not call") }), /credential/);
  await assert.rejects(requestAgent({ provider: "unknown", env, postJson: () => assert.fail("must not call") }));
});

test("eval storage refuses junctions and oversized or stale review evidence", async t => {
  const f = fixture(t), a = await f.command(run("a", ["--live"]));
  let record = JSON.parse(fs.readFileSync(f.file(a.id)));
  record.review = { fingerprint: "stale", result: "accepted" };
  fs.writeFileSync(f.file(a.id), JSON.stringify(record));
  await assert.rejects(f.command(["show", a.id]), /Stale/);
  fs.writeFileSync(f.file(a.id), "x".repeat(2 * 1024 * 1024 + 1));
  await assert.rejects(f.command(["show", a.id]), /file/);
  const linked = fixture(t), outside = fs.mkdtempSync(path.join(os.tmpdir(), "harness-eval-outside-"));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(linked.root, ".harness"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(linked.command(run("a", ["--live"])), /symlink/);
  assert.equal(linked.calls.length, 0); assert.deepEqual(fs.readdirSync(outside), []);
});

test("malformed missing_context is an oracle failure, never an exception", () => {
  for (const missing of [{ id: "buy-registration-rules" }, { includes: "not callable" }, "buy-registration-rules", null, true, 42]) {
    const value = JSON.parse(answer(bank[1])); value.missing_context = missing;
    let result;
    assert.doesNotThrow(() => { result = grade(bank[1], JSON.stringify(value)); });
    assert.equal(result.passed, false); assert.ok(result.failures.includes("missing-context-array"));
    assert.ok(result.failures.includes("required-missing-context"));
  }
});
test("malformed response can retry without aborting remaining evaluation cases", async t => {
  let rejected = false;
  const f = fixture(t, args => {
    const item = bank.find(c => args.prompt.startsWith(c.input));
    const value = JSON.parse(answer(item));
    if (item.id === "missing-context" && !rejected) { value.missing_context = {}; rejected = true; }
    return { text: JSON.stringify(value), response: { usage: { total_tokens: 5 } } };
  });
  const result = await f.command(run("a", ["--live", "--max-requests", "4", "--max-attempts", "2"]));
  assert.equal(result.passed, 3); assert.equal(result.retries, 1); assert.equal(f.calls.length, 4);
  const failed = lastRecord(f).cases.find(c => c.id === "missing-context").attempts[0];
  assert.equal(failed.status, "RECEIVED"); assert.ok(failed.oracle.failures.includes("missing-context-array"));
});
test("provider text concatenation preserves all answer parts and excludes reasoning and other candidates", async () => {
  const scenarios = [
    { provider: "anthropic", response: { content: [{ type: "thinking", thinking: "private", text: "ignore" }, null, { type: "tool_use", text: "ignore" }, { type: "text", text: "{\"status\":" }, { type: "text", text: "\"BLOCKED\"}" }] } },
    { provider: "gemini", response: { candidates: [{ content: { parts: [{ thought: true, text: "private" }, null, { functionCall: { name: "ignore" } }, { text: "{\"status\":" }, { text: "\"BLOCKED\"}" }] } }, { content: { parts: [{ text: "another candidate" }] } }] } }
  ];
  for (const { provider, response } of scenarios) {
    const result = await requestAgent({ provider, model: "mock", prompt: "mock", systemPrompt: "mock", env: { ANTHROPIC_API_KEY: "mock", GEMINI_API_KEY: "mock" }, postJson: async () => response });
    assert.equal(result.text, '{"status":"BLOCKED"}');
  }
});
test("repeated reviews retain ordered history, bind evidence and migrate old single reviews", async t => {
  const f = fixture(t), runResult = await f.command(run("a", ["--live"]));
  const id = runResult.id, fingerprint = runResult.result_fingerprint;
  const review = (result, reason) => f.command(["review", id, "--fingerprint", fingerprint, "--result", result, "--reason", reason]);
  await review("changes-requested", "Improve acceptance criteria");
  await review("accepted", "Rechecked after clarification");
  let record = await f.command(["show", id]);
  assert.equal(record.review_history.length, 2);
  assert.deepEqual(record.review_history.map(r => r.result), ["changes-requested", "accepted"]);
  assert.ok(record.review_history.every(r => r.fingerprint === fingerprint));
  assert.equal(record.review.result, "accepted"); assert.equal(record.result_fingerprint, fingerprint);
  record.review_history[0].reason = "altered";
  fs.writeFileSync(f.file(id), JSON.stringify(record));
  await assert.rejects(f.command(["show", id]), /history/);
  record = JSON.parse(fs.readFileSync(f.file(id)));
  delete record.review_history; delete record.review_history_fingerprint;
  record.review = { result: "changes-requested", reason: "Legacy feedback", fingerprint, minutes: null, at: new Date(0).toISOString() };
  fs.writeFileSync(f.file(id), JSON.stringify(record));
  await review("accepted", "Legacy feedback considered");
  record = await f.command(["show", id]);
  assert.equal(record.review_history.length, 2); assert.equal(record.review_history[0].reason, "Legacy feedback");
  assert.equal(record.result_fingerprint, fingerprint);
});
test("post-response processing failures are not reported as provider request failures", async t => {
  const f = fixture(t, () => ({ text: answer(bank[1]), response: null }));
  await assert.rejects(f.command(run("a", ["--live", "--cases", "missing-context"])), /requires review/);
  assert.equal(lastRecord(f).cases[0].attempts[0].status, "EVALUATION_ERROR");
  assert.equal(f.calls.length, 1);
});
