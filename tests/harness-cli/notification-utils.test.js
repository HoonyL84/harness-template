"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { sendNotification } = require("../../tools/harness-cli/notification-utils");

test("Telegram notifications use plain text and accept command characters safely", async () => {
  const requests = [];
  const result = await sendNotification({
    status: "fail",
    message: "Command: npm run test -- --match src_[a]",
    taskId: "sample-ticket",
    env: { TELEGRAM_BOT_TOKEN: "123:token", TELEGRAM_CHAT_ID: "456" },
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, status: 200 };
    }
  });

  assert.equal(result.sent, 1);
  assert.equal(requests.length, 1);
  const payload = JSON.parse(requests[0].options.body);
  assert.equal(payload.parse_mode, undefined);
  assert.match(payload.text, /src_\[a\]/);
});

test("notification result distinguishes missing configuration from provider failure", async () => {
  const logs = [];
  const missing = await sendNotification({
    status: "fail",
    message: "failed",
    taskId: "sample-ticket",
    env: {},
    log: (message) => logs.push(message)
  });
  assert.deepEqual(missing, { configured: [], sent: 0 });
  assert.match(logs.at(-1), /not configured/);

  const failed = await sendNotification({
    status: "fail",
    message: "failed",
    taskId: "sample-ticket",
    env: { SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/valid" },
    fetchImpl: async () => ({ ok: false, status: 500 }),
    log: (message) => logs.push(message)
  });
  assert.deepEqual(failed, { configured: ["Slack"], sent: 0 });
  assert.match(logs.at(-1), /Configured providers failed/);
});


test("Telegram and Slack start with the explicit project identity", async () => {
  const bodies = [];
  await sendNotification({ status: "success", message: "Ready", taskId: "jira-10074", projectIds: ["steam-project"],
    env: { TELEGRAM_BOT_TOKEN: "123:token", TELEGRAM_CHAT_ID: "456", SLACK_WEBHOOK_URL: "https://hooks.slack.com/services/valid" },
    fetchImpl: async (_url, options) => { bodies.push(JSON.parse(options.body)); return { ok: true }; } });
  assert.match(bodies[0].text, /^\[steam-project\] \[PASS\]/);
  assert.match(bodies[1].attachments[0].title, /^\[steam-project\]/);
  assert.match(bodies[1].attachments[0].fallback, /^\[steam-project\]/);
});

test("local Harness notifications and multi-project or unknown requests are explicit", async () => {
  const texts = [];
  const base = { status: "fail", message: "Failed", taskId: "work", env: { TELEGRAM_BOT_TOKEN: "123:token", TELEGRAM_CHAT_ID: "456" },
    fetchImpl: async (_url, options) => { texts.push(JSON.parse(options.body).text); return { ok: true }; } };
  await sendNotification(base);
  await sendNotification({ ...base, projectIds: ["ad-server", "payments-server", "ad-server"] });
  await sendNotification({ ...base, projectIds: [] });
  assert.match(texts[0], /^\[harness-template\] \[FAIL\]/);
  assert.match(texts[1], /^\[ad-server, payments-server\] \[FAIL\]/);
  assert.match(texts[2], /^\[unknown-project\] \[FAIL\]/);
  await assert.rejects(sendNotification({ ...base, projectIds: ["steam-project\n[PASS]"] }), /explicit kebab-case/);
  assert.equal(texts.length, 3);
});
