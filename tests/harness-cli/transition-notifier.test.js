"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createStateTransitionNotifier, transitionEvent } = require("../../tools/harness-cli/transition-notifier");

const parseArgs = (args) => ({ positional: args.filter((value) => !value.startsWith("--")), options: {} });

test("state transitions map only actionable milestones to notifications", () => {
  const event = transitionEvent("request", ["create", "work"], { request_id: "work", tickets: [{}], content_fingerprint: "abc" }, parseArgs);
  assert.match(event.message, /PLAN_READY/);
  assert.equal(transitionEvent("request", ["show", "work"], {}, parseArgs), null);
  const blocked = transitionEvent("execution", ["prepare", "work"], { execution_id: "e", request_id: "work", updated_at: "now", tickets: [{ ticket_id: "t", status: "BLOCKED", error: "failed" }] }, parseArgs);
  assert.equal(blocked.status, "fail");
  const failed = transitionEvent("release", ["apply", "approval"], null, parseArgs, new Error("stale fingerprint"));
  assert.match(failed.message, /stale fingerprint/);
  assert.match(transitionEvent("release", ["request", "work"], { approval_id: "a", request_id: "work", summary: "reviewed", fingerprint: "fp" }, parseArgs).message, /APPROVAL_REQUIRED/);
  assert.match(transitionEvent("release", ["apply", "a"], { approval_id: "a", request_id: "work", status: "APPLIED", applied_at: "now", release: { operation: "commit" } }, parseArgs).message, /APPLIED/);
  assert.equal(transitionEvent("deployment", ["record"], { deployment_id: "d", project_id: "p", environment: "prod", status: "FAILED" }, parseArgs).status, "fail");
  assert.match(transitionEvent("runner", ["run", "work"], { execution_id: "e", request_id: "work", updated_at: "now", tickets: [{ ticket_id: "t", status: "BLOCKED", error: "Ticket retry budget exhausted", runner: { exhausted_at: "now" } }] }, parseArgs).message, /BLOCKED/);
});

test("transition notifications are deduplicated only after successful delivery", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-transition-"));
  let calls = 0;
  const notifier = createStateTransitionNotifier({ root, parseArgs, notify: async () => { calls += 1; return { sent: 1 }; } });
  const result = { request_id: "work", tickets: [{}], content_fingerprint: "abc" };
  assert.equal((await notifier("request", ["create", "work"], result)).duplicate, false);
  assert.equal((await notifier("request", ["create", "work"], result)).duplicate, true);
  assert.equal(calls, 1);
});

test("failed transition deliveries remain retryable", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-transition-retry-"));
  let calls = 0;
  const notifier = createStateTransitionNotifier({ root, parseArgs, notify: async () => { calls += 1; return { sent: 0 }; } });
  const result = { request_id: "work", tickets: [{}], content_fingerprint: "abc" };
  await notifier("request", ["create", "work"], result);
  await notifier("request", ["create", "work"], result);
  assert.equal(calls, 2);
});

test("notification exceptions never replace the completed command result", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-transition-error-"));
  const logs = [];
  const notifier = createStateTransitionNotifier({ root, parseArgs, notify: async () => { throw new Error("network down"); }, log: (value) => logs.push(value) });
  const result = await notifier("request", ["create", "work"], { request_id: "work", tickets: [{}], content_fingerprint: "abc" });
  assert.equal(result.error, "network down");
  assert.match(logs[0], /notification failed/);
});
