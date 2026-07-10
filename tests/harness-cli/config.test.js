"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createConfigLoader, validateConfigSchema } = require("../../tools/harness-cli/config");

function throwingFail(message) {
  throw new Error(message);
}

test("config schema rejects invalid quick command mappings", () => {
  assert.throws(() => validateConfigSchema({
    config_version: "1.0",
    verify: { quick: { "src/**/*.js": "npm test" } }
  }, throwingFail), /array of non-empty strings/);
});

test("environment values override config limits", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-config-"));
  fs.mkdirSync(path.join(root, ".harness"));
  fs.writeFileSync(path.join(root, ".harness", "config.json"), JSON.stringify({
    config_version: "1.0",
    limits: { max_iterations: 2 }
  }));
  const loadConfig = createConfigLoader({
    root,
    argv: ["node", "index.js", "verify"],
    env: { HARNESS_MAX_ITERATIONS: "7" },
    fail: throwingFail
  });
  assert.equal(loadConfig().limits.maxIterations, 7);
});

test("immutable protected paths survive user configuration", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-config-"));
  fs.mkdirSync(path.join(root, ".harness"));
  fs.writeFileSync(path.join(root, ".harness", "config.json"), JSON.stringify({
    config_version: "1.0",
    auto_fix: { forbidden_segments: ["custom"] },
    l5: { protected_segments: ["custom"] }
  }));
  const config = createConfigLoader({
    root,
    argv: ["node", "index.js", "verify"],
    env: {},
    fail: throwingFail
  })();
  assert.equal(config.auto_fix.forbiddenSegments.has(".git"), true);
  assert.equal(config.auto_fix.forbiddenSegments.has("custom"), true);
  assert.equal(config.l5.protectedSegments.has(".harness"), true);
});

test("verification performance settings honor environment overrides", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-config-"));
  fs.mkdirSync(path.join(root, ".harness"));
  fs.writeFileSync(path.join(root, ".harness", "config.json"), JSON.stringify({
    config_version: "1.0",
    verify: { quick_cache: true, parallel_scripts: [] }
  }));
  const config = createConfigLoader({
    root,
    argv: ["node", "index.js", "verify"],
    env: {
      HARNESS_VERIFY_QUICK_CACHE: "false",
      HARNESS_VERIFY_PARALLEL_SCRIPTS: "coverage,lint"
    },
    fail: throwingFail
  })();
  assert.equal(config.verify.quickCache, false);
  assert.deepEqual([...config.verify.parallelScripts], ["coverage", "lint"]);
});

test("config schema rejects unsafe verification performance types", () => {
  assert.throws(() => validateConfigSchema({
    config_version: "1.0",
    verify: { quick_cache: "yes" }
  }, throwingFail), /quick_cache must be a boolean/);
  assert.throws(() => validateConfigSchema({
    config_version: "1.0",
    verify: { parallel_scripts: "lint" }
  }, throwingFail), /parallel_scripts must be an array/);
});