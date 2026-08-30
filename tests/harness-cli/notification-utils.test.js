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
