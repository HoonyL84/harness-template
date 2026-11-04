"use strict";

const crypto = require("node:crypto");
const { deliveryComplete } = require("./notification-utils");
const fs = require("node:fs");
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
  if (command === "request" && new Set(["create", "revise", "priority", "import-jira"]).has(action)) {
    return { key: `request:${result.request_id}:PLAN_READY:${result.content_fingerprint}`, status: "success", task: result.request_id, message: `${result.request_id} PLAN_READY: review ${result.tickets.length} ticket(s) and approve the fingerprint-bound plan.` };
  }
  if (command === "execution" && new Set(["prepare", "advance", "review-ready"]).has(action)) {
    const blocked = result.tickets?.filter((ticket) => ticket.status === "BLOCKED") || [];
    if (blocked.length > 0) return { key: `execution:${result.execution_id}:BLOCKED:${blocked.map((ticket) => `${ticket.ticket_id}=${ticket.error}`).join("|")}`, status: "fail", task: result.request_id, message: `${result.request_id} BLOCKED: ${blocked.map((ticket) => `${ticket.ticket_id}=${ticket.error}`).join("; ")}` };
    if (action === "review-ready") return { key: `execution:${result.execution_id}:REVIEW_READY:${result.updated_at}`, status: "success", task: result.request_id, message: `${result.request_id} REVIEW_READY: review the diff and verification evidence before requesting release approval.` };
  }
  if (command === "runner" && action === "run") {
    const blocked = result.tickets?.filter((ticket) => !ticket.outcome_notification && ticket.status === "BLOCKED" && (ticket.runner?.exhausted_at || String(ticket.error || "").startsWith("Could not fingerprint"))) || [];
    if (blocked.length > 0) return { key: `runner:${result.execution_id}:BLOCKED:${result.updated_at}`, status: "fail", task: result.request_id, message: `${result.request_id} BLOCKED: ${blocked.map((ticket) => `${ticket.ticket_id}=${ticket.error}`).join("; ")}` };
  }
  if (command === "release" && action === "request") return { key: `release:${result.approval_id}:APPROVAL_REQUIRED:${result.fingerprint}`, status: "success", task: result.request_id, message: `${result.approval_id} APPROVAL_REQUIRED: ${result.summary}\nFingerprint: ${result.fingerprint}` };
  if (command === "release" && action === "apply" && result.status === "APPLIED") return { key: `release:${result.approval_id}:APPLIED:${result.applied_at}`, status: "success", task: result.request_id, message: `${result.approval_id} APPLIED: managed ${result.release.operation} completed.` };
  if (command === "deployment" && action === "record") return { key: `deployment:${result.deployment_id}:${result.status}`, status: result.status === "FAILED" ? "fail" : "success", task: result.project_id, message: `${result.project_id} deployment ${result.deployment_id} recorded as ${result.status} for ${result.environment}.` };
  return null;
}

/** Durable alert outbox; retries never execute the originating operation. */
function createStateTransitionNotifier({ root, parseArgs, notify, log = () => {} }) {
  const legacyPath = path.join(root, ".harness", "local", "notifications", "transitions.json");
  const directory = path.join(root, ".harness", "local", "notifications", "transitions");
  const fileFor = id => {
    if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) throw new Error("Invalid notification event ID");
    return path.join(directory, id + ".json");
  };
  const deliver = async (file, record) => {
    if (record.status === "SENT") return { duplicate: true, event_id: record.event_id };
    record.delivery_attempts += 1;
    record.last_attempt_at = new Date().toISOString();
    writeJsonAtomic(file, record);
    let error;
    try {
      record.delivery = await notify(record.event.status, record.event.message + "\nEvent: " + record.event_id, record.event.task, record.project_ids, record.delivery);
      record.status = deliveryComplete(record.delivery) ? "SENT" : "PENDING";
    } catch {
      error = "Notification transport failed; use notifications retry with the event ID";
      log("[WARN] State transition notification failed: " + error);
    }
    writeJsonAtomic(file, record);
    return { duplicate: false, event_id: record.event_id, status: record.status, delivery: record.delivery, ...(error ? { error } : {}) };
  };
  const afterCommand = async (command, args, result, error) => {
    const event = transitionEvent(command, args, result, parseArgs, error);
    if (!event) return null;
    const eventId = crypto.createHash("sha256").update(event.key).digest("hex");
    try {
      const { positional, options } = parseArgs(args);
      let subject = result;
      const id = positional[1];
      if (!subject?.tickets && !subject?.project_id && typeof id === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) {
        const folder = command === "release" && positional[0] !== "request" ? "releases"
          : ["execution", "runner"].includes(command) ? "executions" : "requests";
        subject = readJson(path.join(root, ".harness", "local", folder, id + ".json"), null);
        if (!subject && ["execution", "runner"].includes(command)) subject = readJson(path.join(root, ".harness", "local", "requests", id + ".json"), null);
      }
      const selected = typeof options.ticket === "string" ? options.ticket.split(",") : null;
      const tickets = (subject?.tickets || []).filter(ticket => event.status === "fail" || !selected || selected.includes(ticket.ticket_id));
      const projectIds = [...new Set([subject?.project_id, ...tickets.map(ticket => ticket.project_id)].filter(Boolean))];
      const file = fileFor(eventId);
      return await withFileLockAsync(file, async () => {
        if (readJson(legacyPath, []).includes(eventId)) return { duplicate: true, event_id: eventId };
        let record = readJson(file, null);
        if (!record) {
          record = { event_id: eventId, event, project_ids: projectIds, status: "PENDING", delivery_attempts: 0, created_at: new Date().toISOString() };
          writeJsonAtomic(file, record);
        }
        return deliver(file, record);
      }, { ttlMs: 120_000 });
    } catch (error) {
      log("[WARN] State transition notification failed: " + error.message);
      return { duplicate: false, event_id: eventId, error: error.message };
    }
  };
  afterCommand.list = () => (fs.existsSync(directory) ? fs.readdirSync(directory) : [])
    .filter(name => /^[a-f0-9]{64}\.json$/.test(name))
    .map(name => readJson(path.join(directory, name), null))
    .filter(record => record?.status === "PENDING")
    .map(record => ({ event_id: record.event_id, status: record.status, task: record.event.task,
      project_ids: record.project_ids, delivery_attempts: record.delivery_attempts,
      channels: record.delivery?.channels || {}, created_at: record.created_at }));
  afterCommand.retry = id => {
    const file = fileFor(id);
    return withFileLockAsync(file, async () => {
      const record = readJson(file, null);
      if (!record || record.event_id !== id) throw new Error("Unknown notification event");
      return deliver(file, record);
    }, { ttlMs: 120_000 });
  };
  return afterCommand;
}
module.exports = { createStateTransitionNotifier, transitionEvent };
