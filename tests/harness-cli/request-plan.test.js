"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  approveRequestPlan,
  createRequestPlan,
  requireRequestReady,
  validateRequestPlan
} = require("../../tools/harness-cli/request-plan");

function profile(id, fingerprint = `${id}-fingerprint`) {
  return { project_id: id, status: "APPROVED", content_fingerprint: fingerprint, verify_commands: ["npm test"] };
}

test("request plans bind project tickets to approved profiles and require approval", () => {
  const profiles = { "ad-server": profile("ad-server"), payments: profile("payments") };
  const plan = createRequestPlan({
    requestId: "portfolio-work",
    goal: "Improve two services",
    tickets: [
      { ticket_id: "ad-cache", project_id: "ad-server", goal: "Improve cache" },
      { ticket_id: "payments-retry", project_id: "payments", goal: "Improve retry", depends_on: ["ad-cache"] }
    ],
    profiles,
    assumptions: ["Tests are local"],
    exclusions: ["No deployment"]
  });
  assert.equal(plan.status, "DRAFT");
  assert.throws(() => requireRequestReady(plan, profiles), /not approved/);
  const approved = approveRequestPlan(plan);
  assert.notEqual(approved.content_fingerprint, plan.content_fingerprint);
  assert.equal(requireRequestReady(approved, profiles), true);
  assert.throws(() => approveRequestPlan(approved), /Only a DRAFT/);
  assert.throws(() => requireRequestReady(approved, { ...profiles, payments: profile("payments", "changed") }), /changed after planning/);
});

test("request plan validation rejects tampering, duplicate tickets, and unapproved projects", () => {
  const profiles = { demo: profile("demo") };
  const plan = createRequestPlan({ requestId: "demo-work", goal: "Do work", projectIds: ["demo"], profiles });
  assert.equal(plan.tickets[0].verification[0], "npm test");
  assert.deepEqual(plan.tickets[0].retry_policy, { max_attempts: 2, stop_on_same_error: true });
  assert.deepEqual(plan.tickets[0].acceptance_criteria, ["Do work"]);
  assert.deepEqual(plan.tickets[0].implementation_steps, ["Do work"]);
  assert.deepEqual(plan.tickets[0].test_plan, { unit: [], integration: [], regression: [], manual: [] });
  assert.throws(() => validateRequestPlan({ ...plan, goal: "tampered" }), /fingerprint/);
  assert.throws(() => validateRequestPlan({ ...plan, status: "APPROVED" }), /fingerprint/);
  assert.throws(() => createRequestPlan({ requestId: "x", goal: "x", projectIds: ["missing"], profiles }), /Approved onboarding/);
  assert.throws(() => createRequestPlan({ requestId: "x", goal: "x", tickets: [
    { ticket_id: "same", project_id: "demo", goal: "a" },
    { ticket_id: "same", project_id: "demo", goal: "b" }
  ], profiles }), /unique/);
  assert.throws(() => createRequestPlan({ requestId: "x", goal: "x", tickets: [
    { ticket_id: "one", project_id: "demo", goal: "a", depends_on: ["missing"] }
  ], profiles }), /Unknown ticket dependency/);
  assert.throws(() => createRequestPlan({ requestId: "x", goal: "x", tickets: [
    { ticket_id: "one", project_id: "demo", goal: "a", depends_on: ["two"] },
    { ticket_id: "two", project_id: "demo", goal: "b", depends_on: ["one"] }
  ], profiles }), /cycle/);
  const custom = createRequestPlan({ requestId: "custom", goal: "x", tickets: [
    { ticket_id: "one", project_id: "demo", goal: "a", retry_policy: { max_attempts: 4, stop_on_same_error: false } }
  ], profiles });
  assert.deepEqual(custom.tickets[0].retry_policy, { max_attempts: 4, stop_on_same_error: false });
  assert.throws(() => createRequestPlan({ requestId: "invalid", goal: "x", tickets: [
    { ticket_id: "one", project_id: "demo", goal: "a", retry_policy: { max_attempts: 6 } }
  ], profiles }), /between 1 and 5/);
  assert.throws(() => createRequestPlan({ requestId: "invalid-bool", goal: "x", tickets: [
    { ticket_id: "one", project_id: "demo", goal: "a", retry_policy: { stop_on_same_error: "yes" } }
  ], profiles }), /must be boolean/);
  const detailed = createRequestPlan({ requestId: "detailed", goal: "x", tickets: [{
    ticket_id: "one", project_id: "demo", goal: "a", context_summary: "Existing cache path", acceptance_criteria: ["hit ratio is recorded"], implementation_steps: ["add metric"], test_plan: { unit: ["metric unit test"], regression: ["npm test"] }
  }], profiles });
  assert.equal(detailed.tickets[0].context_summary, "Existing cache path");
  assert.deepEqual(detailed.tickets[0].test_plan.integration, []);
  assert.throws(() => createRequestPlan({ requestId: "bad-tests", goal: "x", tickets: [{ ticket_id: "one", project_id: "demo", goal: "a", test_plan: [] }], profiles }), /test_plan must be an object/);
});
