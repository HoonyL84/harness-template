"use strict";

const crypto = require("node:crypto");
const { deliveryComplete } = require("./notification-utils");
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

/** Retry notification only; hold a separate bounded lock for each event. */
async function flushRunnerOutcomes(filePath, notify, log, now) {
  const state = readJson(filePath, null);
  for (const snapshot of state?.tickets || []) {
    const eventId = snapshot.outcome_notification?.event_id;
    if (!eventId || snapshot.outcome_notification.status === "SENT") continue;
    try {
      await withFileLockAsync(filePath + ".delivery-" + eventId, async () => {
        const latest = readJson(filePath, null)?.tickets?.find(ticket => ticket.ticket_id === snapshot.ticket_id);
        const event = latest?.outcome_notification;
        if (!event || event.event_id !== eventId || event.status === "SENT") return;
        let delivery = event.delivery;
        let sent = false;
        try {
          delivery = await notify(event.kind, event.message + "\nEvent: " + eventId, latest.ticket_id, [latest.project_id], event.delivery);
          sent = deliveryComplete(delivery);
        } catch { log("[WARN] Outcome notification pending for " + latest.ticket_id + "; use runner notify to retry"); }
        updateJsonLocked(filePath, null, current => {
          const ticket = current.tickets.find(item => item.ticket_id === latest.ticket_id);
          if (ticket?.outcome_notification?.event_id !== eventId) return current;
          ticket.outcome_notification.delivery_attempts += 1;
          ticket.outcome_notification.delivery = delivery;
          ticket.outcome_notification.status = sent ? "SENT" : "PENDING";
          ticket.outcome_notification.last_attempt_at = new Date(now()).toISOString();
          return current;
        });
      }, { ttlMs: 120_000 });
    } catch { log("[WARN] Outcome delivery deferred for " + snapshot.ticket_id + "; use runner notify to retry"); }
  }
}
module.exports = { flushRunnerOutcomes, queueRunnerOutcome };
