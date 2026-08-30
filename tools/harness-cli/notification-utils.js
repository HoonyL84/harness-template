"use strict";

function isConfigured(value, placeholderPattern) {
  return Boolean(value) && !placeholderPattern.test(String(value));
}

async function sendNotification({
  status,
  message,
  taskId,
  env = process.env,
  fetchImpl = globalThis.fetch,
  log = () => {}
}) {
  const slackWebhook = env.SLACK_WEBHOOK_URL;
  const telegramToken = env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = env.TELEGRAM_CHAT_ID;
  const providers = [];
  let sent = 0;

  if (isConfigured(telegramToken, /your_|replace|example/i)
      && isConfigured(telegramChatId, /your_|replace|example/i)) {
    providers.push("Telegram");
    const icon = status === "fail" ? "[FAIL]" : "[PASS]";
    const text = `${icon} [Harness] Task: ${taskId}\n\n${message}`;
    try {
      const response = await fetchImpl(`https://api.telegram.org/bot${telegramToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: telegramChatId, text })
      });
      if (response.ok) sent += 1;
      else log(`  [Telegram] Notification failed: ${response.status}`);
    } catch (error) {
      log(`  [Telegram] Exception: ${error.message}`);
    }
  }

  if (isConfigured(slackWebhook, /your\/webhook\/url|replace|example/i)) {
    providers.push("Slack");
    const color = status === "fail" ? "#ff0000" : "#36a64f";
    const payload = {
      attachments: [{
        fallback: `Harness: ${message}`,
        color,
        title: `[Harness] Task: ${taskId}`,
        text: message,
        footer: "Harness Engineering",
        ts: Math.floor(Date.now() / 1000)
      }]
    };
    try {
      const response = await fetchImpl(slackWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      if (response.ok) sent += 1;
      else log(`  [Slack] Notification failed: ${response.status}`);
    } catch (error) {
      log(`  [Slack] Exception: ${error.message}`);
    }
  }

  if (providers.length === 0) log("  [Notify] Slack/Telegram is not configured; notification skipped.");
  else if (sent === 0) log(`  [Notify] Configured providers failed: ${providers.join(", ")}`);

  return { configured: providers, sent };
}

module.exports = { sendNotification };
