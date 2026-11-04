"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const cli = path.resolve(__dirname, "../../tools/harness-cli/index.js");
const root = path.resolve(__dirname, "../..");

function runCli(args) {
  const env = { ...process.env };
  delete env.NODE_V8_COVERAGE;
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env
  });
}

test("CLI help and version entrypoints execute as real processes", { skip: Boolean(process.env.NODE_V8_COVERAGE) }, (context) => {
  const help = runCli(["help"]);
  if (help.error && ["EACCES", "EPERM"].includes(help.error.code)) {
    context.skip(`Child process execution is unavailable: ${help.error.code}`);
    return;
  }
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Harness CLI/);

  const version = runCli(["version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
});

test("notification CLI exposes pending lookup and rejects invalid retry IDs without sending", { skip: Boolean(process.env.NODE_V8_COVERAGE) }, () => {
  assert.match(runCli(["help"]).stdout, /notifications retry <event-id>/);
  const list = runCli(["notifications", "list"]);
  assert.equal(list.status, 0, list.stderr);
  assert.ok(Array.isArray(JSON.parse(list.stdout)));
  const bad = runCli(["notifications", "retry", "../escape"]);
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Invalid notification event ID/);
  const invalid = runCli(["notifications", "list", "--all"]);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Usage: notifications/);
});
