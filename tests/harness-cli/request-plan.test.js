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
});
