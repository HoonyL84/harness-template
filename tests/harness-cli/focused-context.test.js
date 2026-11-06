"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildAgentContext, POLICY_FILES, REVIEW_FILES } = require("../../tools/harness-cli/agent-context");
const { buildProjectContextBundle } = require("../../tools/harness-cli/project-context");
const { DETAIL_FILES } = require("../../tools/harness-cli/context-policy");
const { isReadOnlyCommand } = require("../../tools/harness-cli/command-effects");
const { printHelp } = require("../../tools/harness-cli/cli-help");
const { needsStackProfile } = require("../../tools/harness-cli/context-policy");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "focused-context-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (file, content = "# Rules\nPreserve approvals.\n") => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  };
  for (const file of [...POLICY_FILES, ...REVIEW_FILES, ...DETAIL_FILES.map(name => `docs/design-docs/${name}`), "docs/design-docs/tech-stack.md", "docs/project/PLANS.md"]) put(file);
  put("package.json", "{}");
  put("docs/design-docs/tech-stack.md", "<!-- harness-profile: java-spring -->\nJava rules\n");
  return { root, put };
}

test("central contexts retain safety and select mode/stack independently of role", t => {
  const { root } = fixture(t);
  for (const stacks of [["node"], ["gradle"], ["maven"]]) {
    for (const executionMode of ["standard", "auto-fix", "l5", "orchestrate"]) {
      for (const role of ["implementer", "reviewer", "architect"]) {
        const bundle = buildAgentContext(root, { stacks, executionMode, role });
        for (const file of POLICY_FILES) assert.ok(bundle.files.includes(file));
        assert.equal(bundle.files.includes("docs/design-docs/tech-stack.md"), stacks[0] !== "node");
        assert.equal(bundle.files.includes("docs/design-docs/auto-fix-policy.md"), executionMode === "auto-fix");
        assert.equal(bundle.files.includes("docs/design-docs/l5-autonomy-policy.md"), ["l5", "orchestrate"].includes(executionMode));
        assert.equal(bundle.files.includes("docs/design-docs/execution-modes.md"), executionMode === "orchestrate");
        assert.equal(bundle.bytes, Buffer.byteLength(bundle.content));
        if (role === "reviewer") for (const file of REVIEW_FILES) assert.ok(bundle.files.includes(file));
      }
    }
  }
  fs.unlinkSync(path.join(root, "package.json"));
  assert.ok(buildAgentContext(root).files.includes("docs/design-docs/tech-stack.md"), "unknown stack keeps profile");
  assert.throws(() => buildAgentContext(root, { executionMode: "typo" }), /Unknown execution/);
  fs.unlinkSync(path.join(root, "docs/design-docs/l5-autonomy-policy.md"));
  assert.throws(() => buildAgentContext(root, { executionMode: "l5" }), /missing/);
  assert.doesNotThrow(() => buildAgentContext(root));
  fs.unlinkSync(path.join(root, "docs/design-docs/safety-contract.md"));
  assert.throws(() => buildAgentContext(root), /missing/);
});

test("managed central bundle keeps policy/review, never unrelated central project context", t => {
  const { root, put } = fixture(t);
  put("docs/project/PLANS.md", "UNRELATED_MAINTENANCE");
  put(".harness/tasks/active/unrelated.md", "UNRELATED_TICKET");
  for (const fullContext of [false, true]) {
    const bundle = buildAgentContext(root, { includeProject: false, fullContext, role: "reviewer" });
    assert.doesNotMatch(bundle.content, /UNRELATED_MAINTENANCE|UNRELATED_TICKET/);
    for (const file of [...POLICY_FILES, ...REVIEW_FILES]) assert.ok(bundle.files.includes(file));
  }
  put("docs/design-docs/safety-contract.md", "required rule\n".repeat(200));
  assert.throws(() => buildAgentContext(root, { includeProject: false, maxBytes: 1024 }), /byte budget/);
  assert.throws(() => buildAgentContext(root, { includeProject: false, taskName: "unrelated" }), /maintenance ticket/);
});

test("external template contexts select details but legacy project policies stay intact", t => {
  const { root } = fixture(t);
  const project = { id: "demo", path: root, stacks: ["node"] };
  const build = options => buildProjectContextBundle(project, { ticket: { goal: "Implement feature" }, ...options });
  const has = (bundle, name) => bundle.files.some(f => f.path === `docs/design-docs/${name}.md`);
  for (const executionMode of ["standard", "auto-fix", "l5", "orchestrate"]) {
    const bundle = build({ executionMode });
    assert.ok(has(bundle, "safety-contract"));
    assert.equal(has(bundle, "l5-autonomy-policy"), ["l5", "orchestrate"].includes(executionMode));
    assert.equal(has(bundle, "auto-fix-policy"), executionMode === "auto-fix");
    assert.ok(!has(bundle, "tech-stack"));
    assert.equal(bundle.trust.can_change_policy, false);
  }
  assert.ok(has(build({ fullContext: true }), "tech-stack"));
  const java = buildProjectContextBundle({ ...project, stacks: ["gradle"] }, { ticket: { goal: "Implement feature" } });
  assert.ok(has(java, "tech-stack"));
  fs.writeFileSync(path.join(root, "docs/design-docs/tech-stack.md"), "# Custom Node rules\nRequired project-specific policy");
  assert.ok(has(build(), "tech-stack"), "custom stack profiles are never dropped by filename");
  assert.ok(has(build({ ticket: { goal: "Read explicit policy", context_refs: [{ path: "docs/design-docs/l5-autonomy-policy.md" }] } }), "l5-autonomy-policy"));
  assert.throws(() => build({ maxBytes: 1024 }), /Required project/);
  assert.throws(() => build({ maxBytes: 1024, fullContext: true }), /Required project/);
  fs.unlinkSync(path.join(root, "docs/design-docs/l5-autonomy-policy.md"));
  assert.throws(() => build({ executionMode: "l5" }), /Required mode context missing/);
  fs.unlinkSync(path.join(root, "docs/design-docs/safety-contract.md"));
  const legacy = build();
  assert.ok(has(legacy, "auto-fix-policy"));
  assert.ok(has(legacy, "tech-stack"));
});

test("help is concise by default, retains advanced commands and canonical planning path", () => {
  let brief, full;
  printHelp(value => { brief = value; }); printHelp(value => { full = value; }, ["--all"]);
  assert.ok(brief.length < full.length / 2);
  assert.match(brief, /request capture[\s\S]*request draft/);
  assert.doesNotMatch(brief, /validate-l5|orchestrate/);
  for (const name of ["validate-l5", "orchestrate", "notifications retry", "request <create|revise", "recover", "context"]) assert.ok(full.includes(name), name);
});

test("read classification is explicit; recovery and unknown actions remain mutating", () => {
  for (const [command, actions] of Object.entries({ request: ["show", "ready", "planning"], runner: ["status"], execution: ["status"], release: ["status"], deployment: ["list", "show"] })) {
    for (const action of actions) assert.equal(isReadOnlyCommand(command, [action, "demo"]), true);
  }
  for (const action of ["notify", "reconcile", "approve", "apply", "run", "generate", "audit", "repair", "unknown"]) {
    for (const command of ["request", "runner", "release", "operations"]) assert.equal(isReadOnlyCommand(command, [action]), false);
  }
  assert.equal(isReadOnlyCommand("unknown", ["status"]), false);
});

test("stack selection rejects unsafe files before inspecting a profile marker", t => {
  const { root } = fixture(t);
  fs.writeFileSync(path.join(root, "docs/design-docs/tech-stack.md"), "x".repeat(1024 * 1024 + 1));
  assert.throws(() => needsStackProfile(root, ["node"]), /oversized/);
  fs.renameSync(path.join(root, "docs/design-docs"), path.join(root, "docs/moved"));
  fs.symlinkSync(path.join(root, "docs/moved"), path.join(root, "docs/design-docs"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => needsStackProfile(root, ["node"]), /symlink|junction/);
});
