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
  assert.match(result.error, /Notification transport failed/);
  assert.match(logs[0], /notification failed/);
});


test("selected tickets identify the project without parsing request names", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-transition-project-"));
  const delivered = [];
  const notifier = createStateTransitionNotifier({ root,
    parseArgs: () => ({ positional: ["review-ready", "unrelated-name"], options: { ticket: "t2" } }),
    notify: async (...args) => { delivered.push(args); return { sent: 1 }; } });
  await notifier("execution", [], { execution_id: "e", request_id: "unrelated-name", updated_at: "now",
    tickets: [{ ticket_id: "t1", project_id: "ad-server" }, { ticket_id: "t2", project_id: "steam-project" }] });
  assert.deepEqual(delivered[0][3], ["steam-project"]);
});

test("failure project comes from the local release record and survives delivery retry", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-transition-release-project-"));
  const folder = path.join(root, ".harness", "local", "releases"); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "approval.json"), JSON.stringify({ tickets: [{ project_id: "steam-project" }] }));
  const projects = [];
  const notifier = createStateTransitionNotifier({ root, parseArgs,
    notify: async (_status, _message, _task, ids) => { projects.push(ids); return { sent: projects.length === 2 ? 1 : 0 }; } });
  await notifier("release", ["apply", "approval"], null, new Error("stale"));
  await notifier("release", ["apply", "approval"], null, new Error("stale"));
  assert.deepEqual(projects, [["steam-project"], ["steam-project"]]);
});

test("deployment and missing failure context do not guess another project", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-transition-project-missing-")); const projects = [];
  const notifier = createStateTransitionNotifier({ root, parseArgs,
    notify: async (_status, _message, _task, ids) => { projects.push(ids); return { sent: 1 }; } });
  await notifier("deployment", ["record"], { project_id: "steam-project", deployment_id: "d", status: "SUCCEEDED", environment: "dev" });
  await notifier("request", ["create", "work"], { request_id: "work", content_fingerprint: "fp", tickets: [{ project_id: "ad-server" }, { project_id: "payments-server" }] });
  await notifier("release", ["apply", "../../outside"], null, new Error("invalid"));
  assert.deepEqual(projects, [["steam-project"], ["ad-server", "payments-server"], []]);
});


test("failed execution preparation uses the existing request without guessing", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-transition-prepare-project-"));
  const folder = path.join(root, ".harness", "local", "requests"); fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(folder, "work.json"), JSON.stringify({ tickets: [{ project_id: "steam-project" }] }));
  let projects;
  const notifier = createStateTransitionNotifier({ root, parseArgs,
    notify: async (_status, _message, _task, ids) => { projects = ids; return { sent: 1 }; } });
  await notifier("execution", ["prepare", "work"], null, new Error("dirty repository"));
  assert.deepEqual(projects, ["steam-project"]);
});

test("aggregate BLOCKED alerts retain every mentioned project despite a ticket filter", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-transition-blocked-project-")); let projects;
  const notifier = createStateTransitionNotifier({ root,
    parseArgs: () => ({ positional: ["advance", "work"], options: { ticket: "t1" } }),
    notify: async (_status, _message, _task, ids) => { projects = ids; return { sent: 1 }; } });
  await notifier("execution", [], { execution_id: "e", request_id: "work",
    tickets: [{ ticket_id: "t1", project_id: "ad-server", status: "BLOCKED", error: "failed" },
      { ticket_id: "t2", project_id: "steam-project", status: "BLOCKED", error: "failed" }] });
  assert.deepEqual(projects, ["ad-server", "steam-project"]);
});

test("failed release alert survives notifier restart and retries without a release operation", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-alert-restart-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = { approval_id: "approval", request_id: "work", status: "APPLIED", applied_at: "now",
    release: { operation: "commit" }, tickets: [{ project_id: "steam-project" }] };
  const first = createStateTransitionNotifier({ root, parseArgs, notify: async () => { throw new Error("offline"); } });
  const failed = await first("release", ["apply", "approval"], result);
  assert.equal(first.list()[0].event_id, failed.event_id);
  assert.equal(first.list()[0].delivery_attempts, 1);
  const delivered = [];
  const restarted = createStateTransitionNotifier({ root, parseArgs,
    notify: async (...args) => { delivered.push(args); return { configured: ["Telegram"], sent: 1, channels: { Telegram: "SENT" } }; } });
  assert.deepEqual(restarted.list()[0].project_ids, ["steam-project"]);
  assert.equal((await restarted.retry(failed.event_id)).status, "SENT");
  assert.match(delivered[0][1], /APPLIED/);
  assert.deepEqual(delivered[0][3], ["steam-project"]);
  assert.equal((await restarted.retry(failed.event_id)).duplicate, true);
  assert.equal(delivered.length, 1);
  assert.deepEqual(restarted.list(), []);
  assert.throws(() => restarted.retry("../escape"), /event ID/);
  await assert.rejects(restarted.retry("a".repeat(64)), /Unknown notification/);
});

test("partial transition delivery retries only the failed provider", async t => {
  const { sendNotification } = require("../../tools/harness-cli/notification-utils");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-alert-partial-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const calls = []; let online = false;
  const notify = (status, message, taskId, projectIds, deliveryState) => sendNotification({
    status, message, taskId, projectIds, deliveryState,
    env: { TELEGRAM_BOT_TOKEN: "123:token", TELEGRAM_CHAT_ID: "456", SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/valid" },
    fetchImpl: async url => { const name = url.includes("telegram") ? "Telegram" : "Slack"; calls.push(name); return { ok: name === "Slack" || online, status: 503 }; }
  });
  const notifier = createStateTransitionNotifier({ root, parseArgs, notify });
  const response = await notifier("request", ["create", "work"], { request_id: "work", tickets: [{}], content_fingerprint: "fp" });
  assert.equal(response.status, "PENDING");
  assert.deepEqual(notifier.list()[0].channels, { Telegram: "PENDING", Slack: "SENT" });
  online = true;
  const fresh = createStateTransitionNotifier({ root, parseArgs, notify });
  assert.equal((await fresh.retry(response.event_id)).status, "SENT");
  assert.deepEqual(calls, ["Telegram", "Slack", "Telegram"]);
});

test("outbox is durable before transport and honors legacy successes", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-alert-legacy-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = { request_id: "work", tickets: [{}], content_fingerprint: "fp" };
  let notifier;
  notifier = createStateTransitionNotifier({ root, parseArgs, notify: async () => {
    assert.equal(notifier.list().length, 1);
    return { sent: 0 };
  } });
  const pending = await notifier("request", ["create", "work"], result);
  const legacy = path.join(root, ".harness/local/notifications/transitions.json");
  fs.writeFileSync(legacy, JSON.stringify([pending.event_id]));
  const old = createStateTransitionNotifier({ root, parseArgs, notify: async () => { throw new Error("must not send"); } });
  assert.equal((await old("request", ["create", "work"], result)).duplicate, true);
});

test("concurrent retries for the same event cannot both send", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-alert-lock-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const queue = createStateTransitionNotifier({ root, parseArgs, notify: async () => ({ sent: 0 }) });
  const pending = await queue("request", ["create", "work"], { request_id: "work", tickets: [{}], content_fingerprint: "fp" });
  let unblock, started; const entered = new Promise(resolve => { started = resolve; });
  const retry = createStateTransitionNotifier({ root, parseArgs, notify: () => { started(); return new Promise(resolve => { unblock = resolve; }); } });
  const sending = retry.retry(pending.event_id);
  await entered;
  await assert.rejects(retry.retry(pending.event_id), /locked/);
  unblock({ sent: 1 });
  await sending;
  assert.deepEqual(retry.list(), []);
});
