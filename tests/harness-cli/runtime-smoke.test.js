"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

// As with cli-process.test, do not mix child CLI coverage into unit coverage totals.
test("real Full CLI checks a live HTTP flow, rejects failed smoke, and keeps Quick separate", { skip: Boolean(process.env.NODE_V8_COVERAGE) }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-runtime-smoke-"));
  fs.cpSync(path.resolve(__dirname, "../../tools"), path.join(root, "tools"), { recursive: true });
  fs.mkdirSync(path.join(root, ".harness"));
  fs.writeFileSync(path.join(root, ".gitignore"), "observability/\n.harness/local/\n");
  fs.writeFileSync(path.join(root, "checks.cjs"), "process.exit(0);\n");
  const httpSmoke = `const assert = require('node:assert/strict');
const server = require('node:http').createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({status:'ready'})); });
server.listen(0, '127.0.0.1', async () => {
  try { const response = await fetch('http://127.0.0.1:' + server.address().port); assert.equal(response.status, 200); assert.deepEqual(await response.json(), {status:'ready'}); }
  catch (error) { process.stderr.write(error.message); process.exitCode = 1; }
  finally { server.close(); }
});`;
  fs.writeFileSync(path.join(root, "smoke.cjs"), httpSmoke);
  const configPath = path.join(root, ".harness/config.json");
  const config = { config_version: "1.0", verify: { full: ["node checks.cjs"], smoke: ["node smoke.cjs"], quick: { "**": ["node checks.cjs"] } } };
  const saveConfig = () => fs.writeFileSync(configPath, JSON.stringify(config));
  saveConfig();
  const git = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" });
  assert.equal(git.status, 0, git.error?.message || git.stderr);
  const env = { ...process.env, TASK_ID: "runtime-fixture", HARNESS_AGENT_MODE: "interactive", HARNESS_AUTO_FIX: "false", HARNESS_DIAGNOSE: "false" };
  delete env.NODE_V8_COVERAGE;
  const verify = (...args) => spawnSync(process.execPath, [path.join(root, "tools/harness-cli/index.js"), "verify", "--offline", ...args], { cwd: root, env, encoding: "utf8", timeout: 30000 });
  const passing = verify("--full");
  assert.equal(passing.status, 0, passing.stderr || passing.stdout);
  assert.match(passing.stdout, /Runtime Smoke/);
  const recordPath = path.join(root, "observability/metrics/runtime-fixture.verify.json");
  assert.equal(JSON.parse(fs.readFileSync(recordPath)).last_full.result, "pass");

  fs.writeFileSync(path.join(root, "smoke.cjs"), "process.stderr.write('runtime assertion failed'); process.exit(7);\n");
  const failed = verify("--full");
  assert.notEqual(failed.status, 0);
  assert.match(failed.stdout + failed.stderr, /runtime assertion failed/);
  assert.equal(JSON.parse(fs.readFileSync(recordPath)).last_full.result, "fail");
  const quick = verify("--quick");
  assert.equal(quick.status, 0, quick.stderr);
  assert.doesNotMatch(quick.stdout, /\[Runtime Smoke\]/);
  assert.equal(JSON.parse(fs.readFileSync(recordPath)).last_full.result, "fail");

  config.verify.smoke = []; saveConfig();
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ private: true, scripts: { "test:smoke": "node smoke.cjs" } }));
  const inferred = verify("--full");
  assert.notEqual(inferred.status, 0);
  assert.match(inferred.stdout, /Runtime Smoke.*npm.*test:smoke/);
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ private: true }));
  const unconfigured = verify("--full");
  assert.equal(unconfigured.status, 0, unconfigured.stderr);
  assert.match(unconfigured.stdout, /Not configured.*does not establish runtime behavior/);
});
