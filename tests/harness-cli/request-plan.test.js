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

test("priority and default three-attempt budget are bound to approval", () => {
  const profiles = { demo: profile("demo") };
  const input = { requestId: "priority", goal: "safe", profiles,
    tickets: [{ ticket_id: "first", project_id: "demo", goal: "safe", priority: "P1" }] };
  const plan = createRequestPlan(input);
  assert.equal(plan.tickets[0].priority, "P1");
  assert.equal(plan.tickets[0].retry_policy.max_attempts, 3);
  const approved = approveRequestPlan(plan);
  const altered = globalThis.structuredClone(approved);
  altered.tickets[0].priority = "P0";
  assert.throws(() => validateRequestPlan(altered), /fingerprint/);
  for (const priority of [null, "urgent", "p1", 1]) {
    assert.throws(() => createRequestPlan({ ...input, tickets: [{ ...input.tickets[0], priority }] }), /priority/);
  }
});

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
  assert.deepEqual(plan.tickets[0].retry_policy, { max_attempts: 3, stop_on_same_error: true });
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

test("readable labels survive planning and publication without replacing tracking markers", () => {
  const { ticketDraft } = require("../../tools/harness-cli/atlassian-payloads");
  const plan = createRequestPlan({ requestId: "labels", goal: "map", profiles: { demo: profile("demo") },
    tickets: [{ ticket_id: "map", project_id: "demo", goal: "map", labels: ["맵설계", "체험리허설"] }] });
  const ticket = plan.tickets[0];
  assert.deepEqual(ticket.labels, ["맵설계", "체험리허설"]);
  const draft = ticketDraft({ jira_projects: { demo: "DEMO" }, jira_issue_types: { demo: "10001" } }, plan, ticket);
  const fields = draft.build("harness-marker").fields;
  assert.deepEqual(fields.labels, ["harness-marker", "harness-kind-development", "개발", "맵설계", "체험리허설"]);
  assert.deepEqual(JSON.parse(fields.description.content[0].content[0].text).labels, ticket.labels);
  const changed = globalThis.structuredClone(approveRequestPlan(plan));
  changed.tickets[0].labels = ["다른업무"];
  assert.throws(() => validateRequestPlan(changed), /fingerprint/);
});

test("readable label validation rejects reserved IDs, whitespace, duplicates and oversized input", () => {
  const { normalizeReadableLabels } = require("../../tools/harness-cli/jira-labels");
  for (const labels of [null, "map", [1], ["맵 설계"], ["harness-marker"], ["0123456789abcdef"], ["a", "a"], ["x".repeat(31)], ["a","b","c","d","e","f"]]) {
    assert.throws(() => normalizeReadableLabels(labels));
  }
  assert.deepEqual(normalizeReadableLabels(), []);
  const plan = createRequestPlan({ requestId: "legacy", goal: "work", profiles: { demo: profile("demo") }, projectIds: ["demo"] });
  assert.equal(Object.hasOwn(plan.tickets[0], "labels"), false);
  assert.doesNotThrow(() => validateRequestPlan(approveRequestPlan(plan)));
});
