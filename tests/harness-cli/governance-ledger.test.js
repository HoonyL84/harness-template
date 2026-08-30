"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { addEvidence, approveRelease, createReleaseApproval, exportEvidenceMarkdown, normalizeReleaseSpec, requireReleaseApproved, searchEvidence, upsertManagedCommitDraft, validateEvidenceReference } = require("../../tools/harness-cli/governance-ledger");

test("release approval is fingerprint-bound and never implicit", () => {
  const execution = {
    status: "REVIEW_READY",
    execution_id: "run-1",
    request_id: "req",
    tickets: [{ ticket_id: "cache", project_id: "ads", status: "REVIEW_READY", branch: "codex/cache", base_commit: "abc", review_fingerprint: "review" }]
  };
  const pending = createReleaseApproval(execution, "tests passed");
  assert.throws(() => createReleaseApproval({ ...execution, status: "PREPARED" }, "tests passed"), /REVIEW_READY/);
  assert.throws(() => requireReleaseApproved(pending, pending.fingerprint), /Explicit/);
  assert.throws(() => approveRelease(pending, "wrong"), /mismatch/);
  assert.equal(requireReleaseApproved(approveRelease(pending, pending.fingerprint), pending.fingerprint), true);
});

test("managed release arguments are normalized before being fingerprint-bound", () => {
  assert.deepEqual(normalizeReleaseSpec({ operation: "commit", message: "  feat: safe  " }), {
    operation: "commit", message: "feat: safe", remote: null, target_branch: null
  });
  assert.throws(() => normalizeReleaseSpec({ operation: "commit" }), /requires a release message/);
  assert.throws(() => normalizeReleaseSpec({ operation: "merge", message: "merge" }), /target branch/);
  assert.throws(() => normalizeReleaseSpec({ operation: "delete" }), /record, commit, push, or merge/);
});

test("ticket-scoped approval releases one review-ready ticket before the whole execution", () => {
  const execution = {
    status: "IN_PROGRESS",
    execution_id: "run-partial",
    request_id: "partial",
    tickets: [
      { ticket_id: "first", project_id: "demo", status: "REVIEW_READY", branch: "codex/first", worktree: "/one", base_commit: "abc", review_fingerprint: "one" },
      { ticket_id: "second", project_id: "demo", status: "WAITING_DEPENDENCY", branch: "codex/second", worktree: "/two", base_commit: null, review_fingerprint: null }
    ]
  };
  const pending = createReleaseApproval(execution, "first reviewed", { operation: "commit", message: "feat: first", ticketIds: ["first"] });
  assert.deepEqual(pending.tickets.map((ticket) => ticket.ticket_id), ["first"]);
  assert.throws(() => createReleaseApproval(execution, "all", { operation: "record" }), /full release approval/);
  assert.throws(() => createReleaseApproval(execution, "second", { operation: "record", ticketIds: ["second"] }), /REVIEW_READY/);
});

test("career ledger only exports public verified items with Git evidence", () => {
  let ledger = addEvidence([], { project_id: "ads", ticket_id: "cache", title: "Cache", status: "DRAFT" });
  assert.throws(() => addEvidence(ledger, { project_id: "ads", ticket_id: "x", title: "Unsafe", status: "VERIFIED" }), /commit or PR/);
  ledger = addEvidence(ledger, { project_id: "ads", ticket_id: "cache", title: "Private Redis cache", status: "VERIFIED", commit: "private123", technologies: ["Redis"] });
  ledger = addEvidence(ledger, { project_id: "ads", ticket_id: "cache", title: "Redis cache", status: "VERIFIED", visibility: "public", commit: "abc123", result: "p95 improved", technologies: ["Redis"], created_at: "2026-08-01T00:00:00.000Z" });
  assert.equal(searchEvidence(ledger, "redis improved", { projectId: "ads", technology: "redis", from: "2026-01-01" }).length, 1);
  assert.match(exportEvidenceMarkdown(ledger), /abc123/);
  assert.doesNotMatch(exportEvidenceMarkdown(ledger), /private123/);
});

test("verified evidence resolves to a registered ticket and real Git reference", () => {
  const item = { project_id: "ads", ticket_id: "cache", commit: "abcdef1" };
  const options = {
    projects: { ads: { path: "/repo/ads" } },
    executions: [{ tickets: [{ project_id: "ads", ticket_id: "cache" }] }],
    runGit: () => ({ status: 0 })
  };
  assert.equal(validateEvidenceReference(item, options), true);
  assert.throws(() => validateEvidenceReference({ ...item, commit: "bad" }, options), /7-40/);
  assert.throws(() => validateEvidenceReference(item, { ...options, runGit: () => ({ status: 1 }) }), /does not exist/);
  assert.throws(() => validateEvidenceReference({ ...item, project_id: "missing" }, options), /not registered/);
  assert.throws(() => validateEvidenceReference({ ...item, ticket_id: "missing" }, options), /not recorded/);
  assert.equal(validateEvidenceReference({ project_id: "ads", ticket_id: "cache", pr: "https://github.com/example/repo/pull/12" }, options), true);
});

test("managed commits create one private draft evidence item", () => {
  const input = { project: { id: "demo", stacks: ["node"] }, ticket: { ticket_id: "cache", goal: "Add cache", implementation_steps: ["add adapter"], verification: { summary: "tests passed", changed_paths: ["src/cache.js"] } }, commit: "abcdef1", requestId: "work", approvalId: "approval" };
  const first = upsertManagedCommitDraft([], input);
  assert.equal(first[0].status, "DRAFT");
  assert.equal(first[0].visibility, "private");
  assert.equal(upsertManagedCommitDraft(first, input).length, 1);
});
