"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  dispatchCommand,
  getCommandMetadata,
  isRuntimeManagedEnv,
  shouldBypassConfig
} = require("../../tools/harness-cli/cli-entrypoint");

test("CLI entrypoint declares Git boundaries for mutating commands", () => {
  assert.equal(getCommandMetadata("verify").requiresGit, true);
  assert.equal(getCommandMetadata("complete-task").requiresGit, true);
  assert.equal(getCommandMetadata("check").requiresGit, false);
  assert.equal(getCommandMetadata("unknown").requiresGit, false);
});

test("help and version bypass broken project config", () => {
  assert.equal(shouldBypassConfig("help"), true);
  assert.equal(shouldBypassConfig("--version"), true);
  assert.equal(shouldBypassConfig("verify"), false);
});

test("runtime-managed environment variables do not create config drift", () => {
  assert.equal(isRuntimeManagedEnv("NODE_V8_COVERAGE"), true);
  assert.equal(isRuntimeManagedEnv("PATH"), true);
  assert.equal(isRuntimeManagedEnv("HARNESS_VERIFY_QUICK_CACHE"), false);
});

test("CLI dispatcher resolves aliases and rejects unknown commands", async () => {
  const calls = [];
  const handlers = {
    help: async (args) => calls.push(["help", args]),
    version: async (args) => calls.push(["version", args])
  };
  assert.equal(await dispatchCommand("--help", ["extra"], handlers), true);
  assert.equal(await dispatchCommand("-v", [], handlers), true);
  assert.equal(await dispatchCommand("missing", [], handlers), false);
  assert.deepEqual(calls, [["help", ["extra"]], ["version", []]]);
});
