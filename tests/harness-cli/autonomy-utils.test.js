"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { runAutonomySoak, simulateAutonomyRun } = require("../../tools/harness-cli/autonomy-utils");

test("autonomy simulation stops at approval boundaries", () => {
  const result = simulateAutonomyRun(
    ["provider_request", "approval_required", "ticket_completed"],
    { maxIterations: 3, maxApiCalls: 6, maxRetries: 3 }
  );
  assert.equal(result.status, "approval_required");
  assert.equal(result.completed, 0);
});

test("autonomy simulation respects budgets across repeated runs", () => {
  assert.deepEqual(runAutonomySoak(5000), { cycles: 5000, scenarios: 5 });
});
