"use strict";

const PREFIX = "node tools/harness-cli/index.js ";
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Inspection only: never infer approval or prescribe a mutation from an error string. */
function inspectionAdvice(command, id) {
  const actions = {
    bootstrap: ["Inspect the initial repository plan and approval before applying or requesting it again", "bootstrap status"],
    runner: ["Execution ownership or outcome needs inspection; do not retry or reconcile an active/uncertain run", "runner status"],
    execution: ["Inspect execution evidence before preparing, verifying or recovering again", "execution status"],
    request: ["Inspect the current plan and approval inputs before changing or approving it", "request show"],
    release: ["Inspect the approval record and current review evidence; do not reuse stale approval", "release status"],
    atlassian: ["Inspect local delivery state, then verify the remote marker/status; an unknown response is not a rejected write", "atlassian status"],
    operations: ["Inspect delivery state before rebuilding local follow-ups or publishing", "atlassian status"]
  };
  if (!Object.hasOwn(actions, command)) return null;
  const [why, action] = actions[command];
  const scoped = !["atlassian", "operations"].includes(command);
  if (scoped && (typeof id !== "string" || !ID.test(id))) return null;
  return { why, next_action: PREFIX + action + (scoped ? " " + id : ""), automatic_action: false };
}

/** Derived guidance does not mutate or persist execution state. */
function executionAdvice(state) {
  const advice = inspectionAdvice("runner", state.request_id);
  if (!advice) return null;
  const tickets = state.tickets || [];
  if (tickets.some(t => t.runner?.lease_id || ["RUNNING", "VERIFYING"].includes(t.status))) {
    return { ...advice, why: "A runner/verification may still own this work. Lease expiry alone does not prove it is safe to retry" };
  }
  if (tickets.some(t => t.status === "BLOCKED")) return { ...advice, why: "Execution is blocked. Inspect attempt, verification and rollback evidence before choosing recovery" };
  if (state.status === "COMPLETED" || (tickets.length > 0 && tickets.every(t => t.status === "COMPLETED"))) {
    const inspect = inspectionAdvice("execution", state.request_id);
    return { ...inspect, why: "All execution tickets are completed and recorded" };
  }
  if (tickets.some(t => t.status === "REVIEW_READY")) return { ...advice, why: "Verification evidence is available, not final human acceptance or Git release permission" };
  if (tickets.some(t => t.status === "WAITING_DEPENDENCY")) return { ...advice, why: "Required predecessor commits or an approved integration are not ready" };
  return advice;
}

function adviceText(advice) {
  return advice ? `Why: ${advice.why}\nSafe Next Action: ${advice.next_action}` : "";
}

module.exports = { inspectionAdvice, executionAdvice, adviceText };
