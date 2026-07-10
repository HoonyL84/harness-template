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

test("CLI help and version entrypoints execute as real processes", { skip: Boolean(process.env.NODE_V8_COVERAGE) }, () => {
  const help = runCli(["help"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Harness CLI/);

  const version = runCli(["version"]);
  assert.equal(version.status, 0, version.stderr);
  assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/);
});