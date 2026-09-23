"use strict";

const crypto = require("node:crypto");
const { readJson, updateJsonLocked, withFileLockAsync } = require("./control-plane-state");

/** Queue the terminal outcome inside the same state write as its evidence. */
function queueRunnerOutcome(state, ticket) {
  const attempts = ticket.runner?.attempts || 0;
  const identity = [state.execution_id, ticket.ticket_id, ticket.status, attempts,
    ticket.verification?.content_fingerprint || "", ticket.error || ""];
  const eventId = crypto.createHash("sha256").update(JSON.stringify(identity)).digest("hex");
  if (ticket.outcome_notification?.event_id === eventId) return;
  const ready = ticket.status === "REVIEW_READY";
  ticket.outcome_notification = {
    event_id: eventId,
    status: "PENDING",
    delivery_attempts: 0,
    kind: ready ? "success" : "fail",
    message: `${ticket.project_id}:${ticket.ticket_id} ${ticket.status} (${attempts}/${ticket.runner?.effective_max_attempts || 3} attempts). `
      + (ready ? "Implementation and verification finished. User review and separate Git approval are required."
        : `${ticket.error || "Execution stopped"}. Review the failure before explicitly authorizing a new execution.`)
      + `\nLocal record: .harness/local/executions/${state.request_id}.json. Follow-ups: operations audit; remote publication requires approval.`
  };
}

/** Retry delivery without rerunning development; acknowledgement is not exactly-once delivery. */
async function flushRunnerOutcomes(filePath, notify, log, now) {
  try {
    return await withFileLockAsync(`${filePath}.delivery`, async () => {
      const state = readJson(filePath, null);
      for (const snapshot of state?.tickets || []) {
        const event = snapshot.outcome_notification;
        if (!event || event.status === "SENT") continue;
        let sent = false;
        try {
          const delivery = await notify(event.kind, `${event.message}\nEvent: ${event.event_id}`, snapshot.ticket_id);
          sent = delivery?.sent > 0;
        } catch {
          log(`[WARN] Outcome notification pending for ${snapshot.ticket_id}; use runner notify to retry`);
        }
        updateJsonLocked(filePath, null, (current) => {
          const ticket = current.tickets.find((item) => item.ticket_id === snapshot.ticket_id);
          if (ticket?.outcome_notification?.event_id !== event.event_id) return current;
          ticket.outcome_notification.delivery_attempts += 1;
          ticket.outcome_notification.status = sent ? "SENT" : "PENDING";
          ticket.outcome_notification.last_attempt_at = new Date(now()).toISOString();
          return current;
        });
      }
    }, { ttlMs: 120_000 });
  } catch (error) {
    log(`[WARN] Outcome delivery deferred: ${error.message}`);
  }
}

module.exports = { flushRunnerOutcomes, queueRunnerOutcome };
