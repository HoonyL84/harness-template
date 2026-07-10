"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createNodeVerificationSteps,
  createQuickCacheKey,
  inferQuickMappings,
  matchesPattern,
  selectQuickCommands,
  tokenizeCommand
} = require("../../tools/harness-cli/verify-utils");

test("globstar matches files directly below and nested below a root", () => {
  assert.equal(matchesPattern("src/app.js", "src/**/*.js"), true);
  assert.equal(matchesPattern("src/domain/app.js", "src/**/*.js"), true);
  assert.equal(matchesPattern("docs/app.js", "src/**/*.js"), false);
});

test("quoted command arguments remain a single token", () => {
  assert.deepEqual(
    tokenizeCommand("node -e \"process.stdout.write('hello world')\""),
    ["node", "-e", "process.stdout.write('hello world')"]
  );
});

test("quick mappings are inferred from package scripts", () => {
  const inferred = inferQuickMappings({ packageScripts: { test: "node --test", lint: "node --check app.js" } });
  assert.deepEqual(
    selectQuickCommands(["src/app.js"], {}, inferred),
    ["npm run test", "npm run lint"]
  );
});

test("configured quick mappings take precedence over inferred mappings", () => {
  const commands = selectQuickCommands(
    ["src/app.js"],
    { "src/**/*.js": ["npm run custom"] },
    { "src/**/*.js": ["npm run test"] }
  );
  assert.deepEqual(commands, ["npm run custom"]);
});

test("unmatched documentation changes remain inconclusive", () => {
  const inferred = inferQuickMappings({ packageScripts: { test: "node --test" } });
  assert.deepEqual(selectQuickCommands(["docs/guide.md"], {}, inferred), []);
});

test("Node verification plan removes build aliases that repeat lint", () => {
  assert.deepEqual(
    createNodeVerificationSteps({
      coverage: "c8 node tests.js",
      lint: "eslint .",
      build: "npm run lint"
    }).map((step) => step.script),
    ["coverage", "lint"]
  );
});

test("quick cache key changes with content, command, or runtime", () => {
  const base = {
    contentFingerprint: "content-a",
    commands: ["npm run test"],
    nodeVersion: "v22",
    platform: "win32",
    arch: "x64"
  };
  assert.equal(createQuickCacheKey(base), createQuickCacheKey({ ...base }));
  assert.notEqual(
    createQuickCacheKey(base),
    createQuickCacheKey({ ...base, contentFingerprint: "content-b" })
  );
});