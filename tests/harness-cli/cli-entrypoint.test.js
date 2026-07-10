"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { getCommandMetadata, shouldBypassConfig } = require("../../tools/harness-cli/cli-entrypoint");

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
