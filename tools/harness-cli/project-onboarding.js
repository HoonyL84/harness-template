"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SCHEMA_VERSION = "1.0";

function fingerprintProfile(profile) {
  const stable = {
    schema_version: profile.schema_version,
    project_id: profile.project_id,
    project_path: profile.project_path,
    status: profile.status,
    approved_at: profile.approved_at,
    git: profile.git,
    stacks: profile.stacks,
    verify_commands: profile.verify_commands,
    context: profile.context,
    execution_policy: profile.execution_policy
  };
  return crypto.createHash("sha256").update(JSON.stringify(stable)).digest("hex");
}

function createOnboardingProfile(project, diagnosis, contextFiles, warnings, now = new Date().toISOString()) {
  const profile = {
    schema_version: SCHEMA_VERSION,
    project_id: project.id,
    project_path: diagnosis.path,
    status: "DRAFT",
    generated_at: now,
    approved_at: null,
    git: {
      head: diagnosis.head,
      branch: diagnosis.branch,
      dirty: diagnosis.dirty,
      changed_paths: diagnosis.changed_paths,
      worktree_fingerprint: diagnosis.worktree_fingerprint,
      remotes: diagnosis.remotes
    },
    stacks: diagnosis.stacks,
    verify_commands: diagnosis.verify_commands,
    context: {
      files: contextFiles.map(({ path: filePath, category, bytes, sha256 }) => ({ path: filePath, category, bytes, sha256 })),
      warnings
    },
    execution_policy: {
      source: "registered-git-project",
      workspace: "isolated-worktree",
      require_clean_execution_tree: true,
      preserve_original_worktree: true,
      require_plan_approval: true,
      require_commit_approval: true
    }
  };
  profile.content_fingerprint = fingerprintProfile(profile);
  return profile;
}

function readOnboardingProfile(profilePath) {
  if (!fs.existsSync(profilePath)) return null;
  let profile;
  try {
    profile = JSON.parse(fs.readFileSync(profilePath, "utf8"));
  } catch (error) {
    throw new Error(`Onboarding profile is invalid JSON: ${error.message}`);
  }
  if (profile?.schema_version !== SCHEMA_VERSION || !profile.project_id || !profile.content_fingerprint) {
    throw new Error(`Onboarding profile must use schema_version ${SCHEMA_VERSION}`);
  }
  if (fingerprintProfile(profile) !== profile.content_fingerprint) {
    throw new Error("Onboarding profile fingerprint does not match its content");
  }
  return profile;
}

function writeOnboardingProfile(profilePath, profile) {
  fs.mkdirSync(path.dirname(profilePath), { recursive: true });
  const tempPath = `${profilePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempPath, profilePath);
}

function approveOnboardingProfile(existing, current, now = new Date().toISOString()) {
  if (!existing) throw new Error("Run project onboard first and review the generated profile");
  if (existing.status !== "DRAFT") throw new Error("Only a DRAFT onboarding profile can be approved");
  if (existing.content_fingerprint !== current.content_fingerprint) {
    throw new Error("Project or context changed after onboarding. Regenerate and review the profile before approval");
  }
  const approved = { ...existing, status: "APPROVED", approved_at: now };
  approved.content_fingerprint = fingerprintProfile(approved);
  return approved;
}

module.exports = {
  approveOnboardingProfile,
  createOnboardingProfile,
  fingerprintProfile,
  readOnboardingProfile,
  writeOnboardingProfile
};
