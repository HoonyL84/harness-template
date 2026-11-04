"use strict";
const CHANNEL_TIMEOUT_MS = 10_000;
const CHANNELS = ["Telegram", "Slack"];

function isConfigured(value, pattern) {
  return Boolean(value) && !pattern.test(String(value));
}

/** Bound transport waits, including injected transports that ignore AbortSignal. */
async function postWithTimeout(fetchImpl, url, body, timeoutMs) {
  const controller = new globalThis.AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => fetchImpl(url, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
      })),
      new Promise((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error("Notification timeout")); }, timeoutMs);
      })
    ]);
  } finally { clearTimeout(timer); }
}

/** Preserve legacy injected notifiers; production transports report channel-level progress. */
function deliveryComplete(delivery) {
  if (delivery?.channels) {
    const states = Object.values(delivery.channels);
    return states.length > 0 && states.every(status => status === "SENT");
  }
  return delivery?.sent > 0 && (!delivery.configured?.length || delivery.sent >= delivery.configured.length);
}

/** Persist only channel progress, never credentials or recipient URLs. */
async function sendNotification({
  status, message, taskId, projectIds = ["harness-template"], deliveryState,
  env = process.env, fetchImpl = globalThis.fetch, log = () => {}, timeoutMs = CHANNEL_TIMEOUT_MS
}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > CHANNEL_TIMEOUT_MS) throw new Error("Notification timeout must be 1-10000 ms");
  if (!Array.isArray(projectIds) || projectIds.length > 20
      || projectIds.some(id => typeof id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))) {
    throw new Error("Notification projects must be explicit kebab-case IDs");
  }
  const prefix = "[" + ([...new Set(projectIds)].join(", ") || "unknown-project") + "]";
  const telegramToken = env.TELEGRAM_BOT_TOKEN, telegramChatId = env.TELEGRAM_CHAT_ID, slackWebhook = env.SLACK_WEBHOOK_URL;
  const configured = [];
  if (isConfigured(telegramToken, /your_|replace|example/i) && isConfigured(telegramChatId, /your_|replace|example/i)) configured.push("Telegram");
  if (isConfigured(slackWebhook, /your\/webhook\/url|replace|example/i)) configured.push("Slack");
  const channels = { ...deliveryState?.channels };
  if (Object.entries(channels).some(([name, value]) => !CHANNELS.includes(name) || !["SENT", "PENDING"].includes(value))) throw new Error("Invalid notification channel state");
  if (!Object.keys(channels).length) for (const name of configured) channels[name] = "PENDING";
  let sent = 0;
  for (const name of Object.keys(channels)) {
    if (channels[name] === "SENT" || !configured.includes(name)) continue;
    const url = name === "Telegram" ? "https://api.telegram.org/bot" + telegramToken + "/sendMessage" : slackWebhook;
    const body = name === "Telegram"
      ? { chat_id: telegramChatId, text: prefix + " " + (status === "fail" ? "[FAIL]" : "[PASS]") + " Task: " + taskId + "\n\n" + message }
      : { attachments: [{ fallback: prefix + " " + message, color: status === "fail" ? "#ff0000" : "#36a64f",
          title: prefix + " Task: " + taskId, text: message, footer: "Harness Engineering", ts: Math.floor(Date.now() / 1000) }] };
    try {
      const response = await postWithTimeout(fetchImpl, url, body, timeoutMs);
      if (response.ok) { channels[name] = "SENT"; sent += 1; }
      else log("  [" + name + "] Notification failed: " + response.status);
    } catch {
      // Transport errors can contain tokens or webhook URLs.
      log("  [" + name + "] Notification failed or timed out; delivery may be uncertain.");
    }
  }
  const complete = deliveryComplete({ channels });
  if (!configured.length) log("  [Notify] Slack/Telegram is not configured; notification pending.");
  else if (!complete) log("  [Notify] Configured providers failed or pending channels are unavailable.");
  return { configured, sent, channels, complete };
}
module.exports = { sendNotification, deliveryComplete };
