"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createRequestCommand } = require("../../tools/harness-cli/request-command");
const { approveOnboardingProfile, createOnboardingProfile, writeOnboardingProfile } = require("../../tools/harness-cli/project-onboarding");
const { emptyRegistry, writeRegistry } = require("../../tools/harness-cli/project-registry");

function parseArgs(args) {
  const positional = [];
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith("--")) positional.push(args[index]);
    else options[args[index].slice(2)] = args[index + 1] && !args[index + 1].startsWith("--") ? args[++index] : true;
  }
  return { positional, options };
}

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-request-command-"));
  const projectPath = path.join(root, "project");
  fs.mkdirSync(projectPath);
  const project = { id: "demo", path: projectPath };
  const diagnosis = { path: projectPath, head: "abc", branch: "main", dirty: false, changed_paths: 0, worktree_fingerprint: "clean", remotes: {}, stacks: ["node"], verify_commands: ["npm test"] };
  const draft = createOnboardingProfile(project, diagnosis, [], []);
  const profile = approveOnboardingProfile(draft, draft);
  writeOnboardingProfile(path.join(root, ".harness", "local", "profiles", "demo.json"), profile);
  const registry = emptyRegistry();
  registry.projects.demo = project;
  writeRegistry(path.join(root, ".harness", "local", "projects.json"), registry);
  return { root };
}

test("request revise replaces only a DRAFT plan with an editable ticket retry policy", () => {
  const { root } = setup();
  const command = createRequestCommand({ root, parseArgs, log: () => {} });
  const initial = command(["create", "planned-work", "--project", "demo", "--goal", "Initial goal"]);
  assert.equal(initial.tickets[0].retry_policy.max_attempts, 2);
  const planFile = path.join(root, "revised-plan.json");
  fs.writeFileSync(planFile, JSON.stringify({
    goal: "Revised goal",
    tickets: [{
      ticket_id: "implementation",
      project_id: "demo",
      goal: "Implement safely",
      retry_policy: { max_attempts: 4, stop_on_same_error: false }
    }]
  }));
  const revised = command(["revise", "planned-work", "--plan-file", planFile]);
  assert.equal(revised.goal, "Revised goal");
  assert.deepEqual(revised.tickets[0].retry_policy, { max_attempts: 4, stop_on_same_error: false });
  assert.notEqual(revised.content_fingerprint, initial.content_fingerprint);
  command(["approve", "planned-work"]);
  assert.throws(() => command(["revise", "planned-work", "--plan-file", planFile]), /Only a DRAFT/);
});
