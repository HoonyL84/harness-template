"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { readJson, withFileLockAsync, writeJsonAtomic } = require("./control-plane-state");

function transitionEvent(command, args, result, parseArgs, error = null) {
  const { positional } = parseArgs(args);
  const action = positional[0];
  if (error && new Set(["request", "execution", "runner", "release", "deployment"]).has(command)) {
    const subject = positional[1] || "unknown";
    const detail = String(error.message || error).slice(-2000);
    return { key: `${command}:${action}:${subject}:FAILED:${detail}`, status: "fail", task: subject, message: `${command} ${action || "command"} FAILED for ${subject}: ${detail}` };
  }
  if (!result) return null;
  if (command === "request" && new Set(["create", "revise"]).has(action)) {
    return { key: `request:${result.request_id}:PLAN_READY:${result.content_fingerprint}`, status: "success", task: result.request_id, message: `${result.request_id} PLAN_READY: review ${result.tickets.length} ticket(s) and approve the fingerprint-bound plan.` };
  }
  if (command === "execution" && new Set(["prepare", "advance", "review-ready"]).has(action)) {
    const blocked = result.tickets?.filter((ticket) => ticket.status === "BLOCKED") || [];
    if (blocked.length > 0) return { key: `execution:${result.execution_id}:BLOCKED:${blocked.map((ticket) => `${ticket.ticket_id}=${ticket.error}`).join("|")}`, status: "fail", task: result.request_id, message: `${result.request_id} BLOCKED: ${blocked.map((ticket) => `${ticket.ticket_id}=${ticket.error}`).join("; ")}` };
    if (action === "review-ready") return { key: `execution:${result.execution_id}:REVIEW_READY:${result.updated_at}`, status: "success", task: result.request_id, message: `${result.request_id} REVIEW_READY: review the diff and verification evidence before requesting release approval.` };
  }
  if (command === "runner" && action === "run") {
    const blocked = result.tickets?.filter((ticket) => ticket.status === "BLOCKED" && (ticket.runner?.exhausted_at || String(ticket.error || "").startsWith("Could not fingerprint"))) || [];
    if (blocked.length > 0) return { key: `runner:${result.execution_id}:BLOCKED:${result.updated_at}`, status: "fail", task: result.request_id, message: `${result.request_id} BLOCKED: ${blocked.map((ticket) => `${ticket.ticket_id}=${ticket.error}`).join("; ")}` };
  }
  if (command === "release" && action === "request") return { key: `release:${result.approval_id}:APPROVAL_REQUIRED:${result.fingerprint}`, status: "success", task: result.request_id, message: `${result.approval_id} APPROVAL_REQUIRED: ${result.summary}\nFingerprint: ${result.fingerprint}` };
  if (command === "release" && action === "apply" && result.status === "APPLIED") return { key: `release:${result.approval_id}:APPLIED:${result.applied_at}`, status: "success", task: result.request_id, message: `${result.approval_id} APPLIED: managed ${result.release.operation} completed.` };
  if (command === "deployment" && action === "record") return { key: `deployment:${result.deployment_id}:${result.status}`, status: result.status === "FAILED" ? "fail" : "success", task: result.project_id, message: `${result.project_id} deployment ${result.deployment_id} recorded as ${result.status} for ${result.environment}.` };
  return null;
}

function createStateTransitionNotifier({ root, parseArgs, notify, log = () => {} }) {
  const eventPath = path.join(root, ".harness", "local", "notifications", "transitions.json");
  return async function afterCommand(command, args, result, error) {
    const event = transitionEvent(command, args, result, parseArgs, error);
    if (!event) return null;
    const eventId = crypto.createHash("sha256").update(event.key).digest("hex");
    try {
      return await withFileLockAsync(eventPath, async () => {
        const sent = readJson(eventPath, []);
        if (sent.includes(eventId)) return { duplicate: true, event_id: eventId };
        const delivery = await notify(event.status, event.message, event.task);
        if (delivery?.sent > 0) writeJsonAtomic(eventPath, [...sent, eventId].slice(-200));
        return { duplicate: false, event_id: eventId, delivery };
      }, { ttlMs: 120_000 });
    } catch (error) {
      log(`[WARN] State transition notification failed: ${error.message}`);
      return { duplicate: false, event_id: eventId, error: error.message };
    }
  };
}

module.exports = { createStateTransitionNotifier, transitionEvent };
