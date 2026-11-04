"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

test("memory CLI gates Full, preserves failure across Quick, and rejects completion with stale success", { skip: Boolean(process.env.NODE_V8_COVERAGE) }, t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-memory-cli-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(path.resolve(__dirname, "../../tools"), path.join(root, "tools"), { recursive: true });
  fs.mkdirSync(path.join(root, ".harness/tasks/active"), { recursive: true });
  fs.mkdirSync(path.join(root, "memory/working"), { recursive: true });
  fs.writeFileSync(path.join(root, ".harness/tasks/active/memory-fixture.md"), "# Memory fixture\n");
  // Ignored notes still require linting; Git fingerprints alone cannot catch them.
  fs.writeFileSync(path.join(root, ".gitignore"), "observability/\n.harness/local/\nmemory/\n");
  fs.writeFileSync(path.join(root, "checks.cjs"), "process.exit(0);\n");
  fs.writeFileSync(path.join(root, ".harness/config.json"), JSON.stringify({ config_version: "1.0",
    verify: { full: ["node checks.cjs"], quick: { "**": ["node checks.cjs"] } } }));
  const git = spawnSync("git", ["init", "--quiet"], { cwd: root, encoding: "utf8" });
  assert.equal(git.status, 0, git.stderr);
  const env = { ...process.env, TASK_ID: "memory-fixture", HARNESS_AGENT_MODE: "interactive",
    HARNESS_AUTO_FIX: "false", HARNESS_DIAGNOSE: "false", TELEGRAM_BOT_TOKEN: "your_token", TELEGRAM_CHAT_ID: "your_chat", SLACK_WEBHOOK_URL: "example" };
  delete env.NODE_V8_COVERAGE;
  const cli = (...args) => spawnSync(process.execPath, [path.join(root, "tools/harness-cli/index.js"), ...args], { cwd: root, env, encoding: "utf8", timeout: 30000 });
  const record = () => JSON.parse(fs.readFileSync(path.join(root, "observability/metrics/memory-fixture.verify.json")));
  const pass = cli("verify", "--full", "--offline");
  assert.equal(pass.status, 0, pass.stderr);
  assert.equal(record().last_full.result, "pass");
  fs.writeFileSync(path.join(root, "memory/working/bad.md"), "# No frontmatter\n");
  const lint = cli("memory", "check");
  assert.notEqual(lint.status, 0);
  assert.match(lint.stdout, /bad.md.*Missing YAML frontmatter/);
  const stale = cli("complete-task", "memory-fixture");
  assert.notEqual(stale.status, 0);
  assert.match(stale.stderr, /Memory format validation failed/);
  const fail = cli("verify", "--full", "--offline");
  assert.notEqual(fail.status, 0);
  assert.equal(record().last_full.result, "fail");
  assert.equal(record().last_full.content_fingerprint, undefined);
  assert.equal(cli("verify", "--quick", "--offline").status, 0);
  assert.equal(record().last_full.result, "fail");
  assert.match(cli("complete-task", "memory-fixture").stderr, /not marked as pass in full mode/);
  fs.unlinkSync(path.join(root, "memory/working/bad.md"));
  fs.mkdirSync(path.join(root, "memory/unknown"));
  assert.notEqual(cli("verify", "--full", "--offline").status, 0);
  fs.rmdirSync(path.join(root, "memory/unknown"));
  // A verification command cannot introduce an ignored invalid note then obtain success.
  fs.writeFileSync(path.join(root, "checks.cjs"), "require('node:fs').writeFileSync('memory/working/bad.md', '# Invalid');\n");
  assert.notEqual(cli("verify", "--full", "--offline").status, 0);
  assert.equal(record().last_full.result, "fail");
  assert.match(cli("memory", "check", "--extra").stderr, /Usage: memory check/);
});
