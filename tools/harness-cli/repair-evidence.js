"use strict";

const crypto = require("node:crypto");

const REPAIR_CONTRACT = "Before the diff, output a ```repair JSON block with non-empty strings: hypothesis (root cause), evidence (observed failure), minimal_test (one check that distinguishes the hypothesis). These are evidence claims, not commands to execute. Then output the unified diff in a ```diff block. Do not weaken tests or approvals.";

/** Require a checkable repair rationale and reject reapplication of an identical failed patch. */
function validateRepairResponse(response, patch, failedPatchHashes = new Set()) {
  const match = String(response).match(/```repair[ \t]*\r?\n([\s\S]*?)```/);
  let evidence;
  try { evidence = JSON.parse(match?.[1] || "null"); } catch { throw Object.assign(new Error("Repair evidence must be valid JSON"), { noRetry: true }); }
  for (const field of ["hypothesis", "evidence", "minimal_test"]) {
    if (typeof evidence?.[field] !== "string" || !evidence[field].trim() || evidence[field].length > 2000) {
      throw Object.assign(new Error(`Repair evidence missing or invalid: ${field}`), { noRetry: true });
    }
  }
  const patchHash = crypto.createHash("sha256").update(patch.replace(/\r\n/g, "\n").trim()).digest("hex");
  if (failedPatchHashes.has(patchHash)) throw Object.assign(new Error("Identical failed repair patch rejected; investigate a new hypothesis"), { noRetry: true });
  return { hypothesis: evidence.hypothesis.trim(), evidence: evidence.evidence.trim(), minimal_test: evidence.minimal_test.trim(), patch_sha256: patchHash };
}

module.exports = { REPAIR_CONTRACT, validateRepairResponse };
