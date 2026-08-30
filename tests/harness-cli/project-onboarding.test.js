"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  approveOnboardingProfile,
  createOnboardingProfile,
  readOnboardingProfile,
  writeOnboardingProfile
} = require("../../tools/harness-cli/project-onboarding");

function fixture() {
  const project = { id: "demo" };
  const diagnosis = {
    path: path.resolve("demo"), head: "abc123", branch: "main", dirty: true, changed_paths: 2,
    worktree_fingerprint: "worktree123",
    remotes: { origin: { fetch: "https://example/demo.git" } }, stacks: ["node"], verify_commands: ["npm test"]
  };
  const files = [{ path: "README.md", category: "readme", bytes: 10, sha256: "deadbeef" }];
  return { project, diagnosis, files };
}

test("onboarding profiles capture execution policy and require content-matched approval", () => {
  const { project, diagnosis, files } = fixture();
  const draft = createOnboardingProfile(project, diagnosis, files, ["AGENTS.md missing"], "2026-01-01T00:00:00Z");
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.execution_policy.require_commit_approval, true);
  const approved = approveOnboardingProfile(draft, { ...draft }, "2026-01-02T00:00:00Z");
  assert.equal(approved.status, "APPROVED");
  assert.notEqual(approved.content_fingerprint, draft.content_fingerprint);
  const changed = createOnboardingProfile(project, { ...diagnosis, head: "def456" }, files, []);
  assert.throws(() => approveOnboardingProfile(draft, changed), /changed after onboarding/);
  assert.throws(() => approveOnboardingProfile(null, draft), /Run project onboard/);
  assert.throws(() => approveOnboardingProfile(approved, draft), /Only a DRAFT/);
});

test("onboarding profiles persist atomically and reject tampering", () => {
  const { project, diagnosis, files } = fixture();
  const profilePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "harness-onboard-")), "profiles", "demo.json");
  const draft = createOnboardingProfile(project, diagnosis, files, []);
  writeOnboardingProfile(profilePath, draft);
  assert.equal(readOnboardingProfile(profilePath).content_fingerprint, draft.content_fingerprint);
  const tampered = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  tampered.status = "APPROVED";
  fs.writeFileSync(profilePath, JSON.stringify(tampered));
  assert.throws(() => readOnboardingProfile(profilePath), /fingerprint/);
  tampered.status = "DRAFT";
  tampered.verify_commands.push("unsafe command");
  fs.writeFileSync(profilePath, JSON.stringify(tampered));
  assert.throws(() => readOnboardingProfile(profilePath), /fingerprint/);
  fs.writeFileSync(profilePath, "{");
  assert.throws(() => readOnboardingProfile(profilePath), /invalid JSON/);
  fs.rmSync(profilePath);
  assert.equal(readOnboardingProfile(profilePath), null);
});
