"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createDiagnosticCommands } = require("../../tools/harness-cli/diagnostic-commands");

function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "diagnostic-commands-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const logs = [], rendered = [];
  const command = createDiagnosticCommands({
    ROOT: root,
    parseArgs: args => ({ positional: args.filter(v => !v.startsWith("--")), options: { cycles: args[0] === "--cycles" ? args[1] : undefined } }),
    fail: message => { throw new Error(message); }, log: message => logs.push(message),
    validateAutoFixPatch: patch => { assert.equal(patch, "fixture"); return ["src/demo.js"]; },
    validateL5Patch: patch => { assert.equal(patch, "fixture"); return { paths: ["package.json"], highRisk: ["package.json"] }; },
    renderPrompt: (...args) => rendered.push(args), readText: () => "role", VALID_ROLES: ["planner", "implementer"],
    ...overrides
  });
  return { root, command, logs, rendered };
}

test("extracted diagnostic handlers preserve validator inputs, messages and failures", t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, "sample.patch"), "fixture");
  for (const method of ["commandValidateAutoFix", "commandValidateL5Patch"]) {
    f.command[method](["sample.patch"]);
    assert.throws(() => f.command[method]([]), /Usage/);
    assert.throws(() => f.command[method](["../missing.patch"]), /inside repository/);
  }
  assert.match(f.logs.join("\n"), /Auto-fix patch policy passed: src\/demo.js/);
  assert.match(f.logs.join("\n"), /Approval required: package.json/);
  f.command.commandValidatePrompts();
  assert.equal(f.rendered.length, 3);
  assert.equal(f.rendered[0][1].ROLE, "implementer");
  assert.throws(() => fixture(t, { readText: () => "" }).command.commandValidatePrompts(), /missing or empty/);
  f.command.commandValidateL5Soak(["--cycles", "2"]);
  assert.match(f.logs.at(-1), /cycles=2/);
  for (const value of ["-1", "100001", "bad"]) assert.throws(() => f.command.commandValidateL5Soak(["--cycles", value]), /integer between/);
  assert.throws(() => fixture(t, { assessRecovery: () => ({ action: "wrong" }) }).command.commandValidateRecovery(), /expected retry_agent/);
});

test("API retry diagnostic restores injected counter and environment on pass and failure", async t => {
  const keys = ["HARNESS_API_MAX_RETRIES", "HARNESS_API_RETRY_BASE_MS", "HARNESS_API_RETRY_MAX_MS", "HARNESS_MAX_PROVIDER_REQUESTS"];
  const before = keys.map(key => process.env[key]);
  let counter = 7;
  const f = fixture(t, {
    getProviderRequestCount: () => counter,
    setProviderRequestCount: value => { counter = value; },
    postJson: async url => {
      counter++;
      let response = await fetch(url);
      if (response.status === 503) { counter++; response = await fetch(url); }
      if (!response.ok) throw new Error((await response.json()).error.code);
      return response.json();
    }
  });
  await f.command.commandValidateApiRetry();
  assert.match(f.logs.at(-1), /API retry policy passed/);
  assert.equal(counter, 7);
  assert.deepEqual(keys.map(key => process.env[key]), before);
  const failed = fixture(t, {
    getProviderRequestCount: () => counter, setProviderRequestCount: value => { counter = value; },
    postJson: async () => { throw new Error("injected failure"); }
  });
  await assert.rejects(failed.command.commandValidateApiRetry(), /injected failure/);
  assert.equal(counter, 7);
  assert.deepEqual(keys.map(key => process.env[key]), before);
});
