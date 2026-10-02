"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { buildAgentContext, POLICY_FILES, resolveAgentTaskScope } = require("../../tools/harness-cli/agent-context");
const { validateRepairResponse } = require("../../tools/harness-cli/repair-evidence");
const { extractUnifiedDiff } = require("../../tools/harness-cli/agent-runner");

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-lean-test-"));
  for (const file of [...POLICY_FILES, "docs/project/PLANS.md", "docs/design-docs/tech-stack.md", "docs/design-docs/agent-roles.md", ".harness/tasks/active/demo.md"]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), `# ${file}\nDo not bypass approvals.\n`);
  }
  fs.writeFileSync(path.join(root, "docs/design-docs/agent-roles.md"), "Optional role definitions.\n".repeat(50));
  return root;
}

test("focused context retains complete policies and ticket, with deterministic omission metadata", () => {
  const root = fixture();
  const focused = buildAgentContext(root, { taskName: "demo" });
  const full = buildAgentContext(root, { taskName: "demo", fullContext: true });
  for (const file of POLICY_FILES) assert.ok(focused.files.includes(file));
  assert.ok(focused.files.includes(".harness/tasks/active/demo.md"));
  assert.ok(focused.bytes < full.bytes);
  assert.equal(focused.bytes, Buffer.byteLength(focused.content));
  assert.equal(focused.estimated_input_tokens, Math.ceil(focused.bytes / 3));
  assert.equal(focused.omitted.length, 1);
  assert.ok(buildAgentContext(root, { type: "architect" }).files.includes("docs/design-docs/agent-roles.md"));
  assert.ok(buildAgentContext(root, { type: "review" }).files.includes("docs/design-docs/agent-roles.md"));
});

test("managed API scope avoids unrelated active tickets while standalone scope remains strict", () => {
  const root = fixture();
  const managed = resolveAgentTaskScope(root, { project_id: "demo", request_id: "work", ticket_id: "feature" }, () => { throw new Error("Multiple unrelated active tickets"); });
  assert.equal(managed.taskName, "demo-work-feature");
  assert.equal(managed.localTicket, undefined);
  assert.equal(resolveAgentTaskScope(root, null, () => "demo").localTicket, "demo");
  assert.equal(resolveAgentTaskScope(root, null, () => "missing").localTicket, undefined);
  assert.throws(() => resolveAgentTaskScope(root, null, () => { throw new Error("Multiple active tickets"); }), /Multiple/);
  assert.throws(() => resolveAgentTaskScope(root, { project_id: "../bad" }, () => "demo"), /Invalid managed/);
});

test("context loads only explicit ticket documents and never silently truncates required input", () => {
  const root = fixture();
  fs.writeFileSync(path.join(root, "docs/detail.md"), "Detailed requirement.");
  fs.writeFileSync(path.join(root, "docs/unrelated.md"), "Unrelated history.");
  fs.writeFileSync(path.join(root, ".harness/tasks/active/demo.md"), "# Ticket\n## Context Files\n- `docs/detail.md`\n\n## Goal\n- Work\n");
  const focused = buildAgentContext(root, { taskName: "demo" });
  assert.match(focused.content, /Detailed requirement/);
  assert.doesNotMatch(focused.content, /Unrelated history/);
  assert.throws(() => buildAgentContext(root, { taskName: "demo", maxBytes: 1024 }), /byte budget/);
  fs.writeFileSync(path.join(root, "AGENTS.md"), "x".repeat(2048));
  fs.writeFileSync(path.join(root, ".harness/tasks/active/demo.md"), "## Context Files\n- docs/not-read-after-overflow.md\n");
  assert.throws(() => buildAgentContext(root, { taskName: "demo", maxBytes: 1024 }), /byte budget/);
  assert.throws(() => buildAgentContext(root, { maxBytes: 0 }), /maxBytes/);
  assert.throws(() => buildAgentContext(root, { maxBytes: 1048577 }), /maxBytes/);
  assert.throws(() => buildAgentContext(root, { taskName: "../secret" }), /kebab-case/);
  fs.writeFileSync(path.join(root, "AGENTS.md"), "a".repeat(1024 * 1024 + 1));
  assert.throws(() => buildAgentContext(root), /maximum size/);
});

test("context rejects missing files, malformed lists, secret aliases and traversal", () => {
  const root = fixture();
  const ticket = path.join(root, ".harness/tasks/active/demo.md");
  for (const value of ["- docs/missing.md", "free form", "- .env.local", "- docs/../secret.md", "- docs/.env.md", "- docs/a:secret.md"]) {
    fs.writeFileSync(ticket, `## Context Files\n${value}\n`);
    assert.throws(() => buildAgentContext(root, { taskName: "demo" }), /missing|Unsafe|must list/);
  }
  assert.throws(() => buildAgentContext(root, { taskName: "missing" }), /missing/);
});

test("context rejects a junction that redirects a selected document outside the root", () => {
  const root = fixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "harness-lean-outside-"));
  fs.writeFileSync(path.join(outside, "private.md"), "outside data");
  fs.symlinkSync(outside, path.join(root, "docs/linked"), process.platform === "win32" ? "junction" : "dir");
  fs.writeFileSync(path.join(root, ".harness/tasks/active/demo.md"), "## Context Files\n- docs/linked/private.md\n");
  assert.throws(() => buildAgentContext(root, { taskName: "demo" }), /symlink|junction/);
});

test("repair evidence is recorded separately from the diff and duplicate failed patches are rejected", () => {
  const diff = "diff --git a/src/a.js b/src/a.js\n--- a/src/a.js\n+++ b/src/a.js\n@@ -1 +1 @@\n-old\n+new\n";
  const response = '```repair\n{"hypothesis":"wrong bound","evidence":"boundary test failed","minimal_test":"run boundary case"}\n```\n```diff\n' + diff + "```";
  const patch = extractUnifiedDiff(response);
  assert.equal(patch, diff);
  const result = validateRepairResponse(response, patch);
  assert.equal(result.hypothesis, "wrong bound");
  assert.match(result.patch_sha256, /^[a-f0-9]{64}$/);
  assert.throws(() => validateRepairResponse(response, patch.replace(/\n/g, "\r\n"), new Set([result.patch_sha256])), /Identical failed/);
  assert.throws(() => validateRepairResponse(diff, diff), error => error.noRetry === true);
  assert.throws(() => validateRepairResponse("```repair\ninvalid\n```", diff), /valid JSON/);
  for (const field of ["hypothesis", "evidence", "minimal_test"]) {
    const value = { hypothesis: "a", evidence: "b", minimal_test: "c", [field]: "" };
    assert.throws(() => validateRepairResponse(`\`\`\`repair\n${JSON.stringify(value)}\n\`\`\``, diff), /missing or invalid/);
    value[field] = "a".repeat(2001);
    assert.throws(() => validateRepairResponse(`\`\`\`repair\n${JSON.stringify(value)}\n\`\`\``, diff), /missing or invalid/);
  }
});
