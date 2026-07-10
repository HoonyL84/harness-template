"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { getCommandMetadata, isRuntimeManagedEnv, shouldBypassConfig } = require("../../tools/harness-cli/cli-entrypoint");

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