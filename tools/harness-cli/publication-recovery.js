"use strict";
/** Advice only: never requeue, publish, delete, or infer approval. */
function recoveryAdvice(entry) {
  const id = entry?.id;
  if (typeof id !== "string" || !/^[a-zA-Z0-9-]{1,128}$/.test(id)) return { status: "invalid-entry", commands: [], instruction: "Inspect the local outbox; invalid entry identifier" };
  const prefix = "node tools/harness-cli/index.js atlassian ";
  const choices = {
    PENDING: ["Review payload; publishing requires a new digest approval or valid scoped consent", [prefix + "preview"]],
    REJECTED: ["Fix the definite rejection (credentials, permissions or request), explicitly requeue, then review a NEW preview digest", [prefix + "retry-rejected " + id + " --approve " + id, prefix + "preview"]],
    SENDING: ["Delivery result is uncertain. Verify the remote marker/status before reconciliation; DO NOT POST again", [prefix + "reconcile " + id + " --remote-id <verified-remote-id>"]],
    NEEDS_RECONCILIATION: ["Delivery result is uncertain. Verify the remote marker/status before reconciliation; DO NOT POST again", [prefix + "reconcile " + id + " --remote-id <verified-remote-id>"]],
    SUPERSEDED: ["Evidence or destination changed. Reverify/review and prepare a new draft; do not replay old approval", ["node tools/harness-cli/index.js operations audit"]],
    SYNCED: ["Acknowledged delivery; no retry needed", []]
  };
  const [instruction, commands] = choices[entry.status] || ["Inspect unknown state; no automatic action", []];
  return { id, status: entry.status, instruction, commands, automatic_action: false };
}
module.exports = { recoveryAdvice };
