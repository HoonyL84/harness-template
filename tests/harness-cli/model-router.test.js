"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { approveRequestPlan, createRequestPlan, planFingerprint, validateRequestPlan } = require("../../tools/harness-cli/request-plan");
const { buildExecutionState, assertExecutionMatchesPlan } = require("../../tools/harness-cli/project-execution");
const {
  DEFAULT_MODELS,
  normalizeRisk,
  resolveModelTier,
  selectModel,
  selectModelRoute
} = require("../../tools/harness-cli/model-router");

test("model router exposes latest default models across OpenAI, Anthropic, and Gemini", () => {
  assert.deepEqual(DEFAULT_MODELS.openai, {
    fast: "gpt-6-luna",
    standard: "gpt-6.1-sol",
    strong: "gpt-6-astra"
  });
  assert.deepEqual(DEFAULT_MODELS.anthropic, {
    fast: "claude-haiku-5-5",
    standard: "claude-sonnet-5-5",
    strong: "claude-opus-5-5"
  });
  assert.deepEqual(DEFAULT_MODELS.gemini, {
    fast: "gemini-3.5-flash-lite",
    standard: "gemini-3.8-flash",
    strong: "gemini-4-argon"
  });
});

test("model router selects fast tier for low-risk docs, planning, and first-attempt code tasks", () => {
  const docsRoute = selectModelRoute("openai", { type: "docs", priority: "P3", risk: "낮음" }, {});
  assert.equal(docsRoute.tier, "fast");
  assert.equal(docsRoute.model, "gpt-6-luna");
  assert.equal(docsRoute.reason, "docs-low-cost-tier");
  assert.equal(docsRoute.escalated, false);

  const codeRoute = selectModelRoute("anthropic", { type: "code", priority: "P2", risk: "low", scopeCount: 2 }, {});
  assert.equal(codeRoute.tier, "fast");
  assert.equal(codeRoute.model, "claude-haiku-5-5");
  assert.equal(codeRoute.reason, "low-risk-cost-optimized");

  const planningRoute = selectModelRoute("gemini", { ticketKind: "planning", priority: "P2" }, {});
  assert.equal(planningRoute.tier, "fast");
  assert.equal(planningRoute.model, "gemini-3.5-flash-lite");
});

test("model router selects standard or strong tier for review, high priority, high risk, and architecture tasks", () => {
  const reviewRoute = selectModelRoute("openai", { type: "review", role: "reviewer" }, {});
  assert.equal(reviewRoute.tier, "standard");
  assert.equal(reviewRoute.model, "gpt-6.1-sol");

  const p1Route = selectModelRoute("anthropic", { type: "code", priority: "P1", risk: "low" }, {});
  assert.equal(p1Route.tier, "standard");
  assert.equal(p1Route.model, "claude-sonnet-5-5");

  const wideScopeRoute = selectModelRoute("gemini", { type: "code", scopeCount: 5 }, {});
  assert.equal(wideScopeRoute.tier, "standard");
  assert.equal(wideScopeRoute.model, "gemini-3.8-flash");

  const p0Route = selectModelRoute("openai", { type: "code", priority: "P0" }, {});
  assert.equal(p0Route.tier, "strong");
  assert.equal(p0Route.model, "gpt-6-astra");

  const highRiskRoute = selectModelRoute("anthropic", { type: "code", risk: "높음" }, {});
  assert.equal(highRiskRoute.tier, "strong");
  assert.equal(highRiskRoute.model, "claude-opus-5-5");

  const archRoute = selectModelRoute("gemini", { type: "architect", role: "architect" }, {});
  assert.equal(archRoute.tier, "strong");
  assert.equal(archRoute.model, "gemini-4-argon");
});

test("model router escalates cheaper tiers automatically on retry or repair attempts", () => {
  const attempt1 = selectModelRoute("openai", { type: "code", priority: "P2", attempt: 1 }, {});
  assert.equal(attempt1.tier, "fast");
  assert.equal(attempt1.model, "gpt-6-luna");
  assert.equal(attempt1.escalated, false);

  const attempt2 = selectModelRoute("openai", { type: "code", priority: "P2", attempt: 2 }, {});
  assert.equal(attempt2.tier, "standard");
  assert.equal(attempt2.base_tier, "fast");
  assert.equal(attempt2.model, "gpt-6.1-sol");
  assert.equal(attempt2.escalated, true);

  const repairAttempt = selectModelRoute("anthropic", { type: "code", priority: "P2", attempt: 1, repairRequired: true }, {});
  assert.equal(repairAttempt.tier, "standard");
  assert.equal(repairAttempt.model, "claude-sonnet-5-5");
  assert.equal(repairAttempt.escalated, true);

  const attempt3 = selectModelRoute("gemini", { type: "code", priority: "P2", attempt: 3 }, {});
  assert.equal(attempt3.tier, "strong");
  assert.equal(attempt3.base_tier, "fast");
  assert.equal(attempt3.model, "gemini-4-argon");
  assert.equal(attempt3.escalated, true);

  const standardToStrong = selectModelRoute("openai", { type: "review", attempt: 3 }, {});
  assert.equal(standardToStrong.tier, "strong");
  assert.equal(standardToStrong.base_tier, "standard");
  assert.equal(standardToStrong.escalated, true);
});

test("model router respects explicit tier override, environment variables, and rejects invalid inputs", () => {
  const env = {
    OPENAI_MODEL_FAST: "custom-fast",
    OPENAI_MODEL: "custom-standard",
    OPENAI_MODEL_STRONG: "custom-strong"
  };
  const overridden = selectModelRoute("openai", { type: "docs", tierOverride: "strong" }, env);
  assert.equal(overridden.tier, "strong");
  assert.equal(overridden.model, "custom-strong");
  assert.equal(overridden.source, "env");
  assert.equal(selectModel("openai", "code", {}, env), "custom-fast");

  assert.equal(normalizeRisk("높음"), "high");
  for (const risk of ["고위험 변경", "unknown", null, 1, ""]) assert.throws(() => normalizeRisk(risk), /Risk must/);
  assert.throws(() => resolveModelTier({ risk: "high", tierOverride: "fast" }), /High-risk/);
  assert.equal(resolveModelTier({ risk: "high", tierOverride: "standard" }).tier, "standard");
  assert.equal(normalizeRisk("보통"), "medium");
  assert.equal(normalizeRisk("낮음"), "low");

  assert.throws(() => selectModelRoute("unknown-provider", {}), /Unsupported provider/);
  assert.throws(() => resolveModelTier({ tierOverride: "ultra" }), /Unsupported model tier/);
  assert.throws(() => resolveModelTier({ attempt: 0 }), /positive integer/);
});

test("risk and rationale bind approval; legacy plans and executions load without fingerprint rewriting", () => {
  const profiles = { demo: { status: "APPROVED", content_fingerprint: "profile", verify_commands: ["node --test"] } };
  const draft = createRequestPlan({ requestId: "risk-test", goal: "Feature", profiles,
    tickets: [{ ticket_id: "task", project_id: "demo", goal: "Feature", risk: "높음", risk_reason: "Auth boundary" }] });
  const approved = approveRequestPlan(draft);
  for (const field of ["risk", "risk_reason", "risk_source"]) {
    const changed = JSON.parse(JSON.stringify(approved));
    changed.tickets[0][field] = field === "risk" ? "low" : "changed";
    assert.notEqual(planFingerprint(changed), approved.content_fingerprint);
    assert.throws(() => validateRequestPlan(changed), /fingerprint/);
  }
  const execution = buildExecutionState(approved, process.cwd());
  delete execution.tickets[0].risk;
  assert.throws(() => assertExecutionMatchesPlan(execution, approved, process.cwd()), /risk/);

  const legacy = JSON.parse(JSON.stringify(draft));
  for (const field of ["risk", "risk_reason", "risk_source"]) delete legacy.tickets[0][field];
  legacy.content_fingerprint = planFingerprint(legacy);
  const oldApproved = approveRequestPlan(legacy);
  const snapshot = JSON.stringify(oldApproved);
  validateRequestPlan(oldApproved);
  const oldState = buildExecutionState(oldApproved, process.cwd());
  assert.equal(oldState.tickets[0].risk_source, "legacy-default");
  for (const field of ["risk", "risk_reason", "risk_source"]) delete oldState.tickets[0][field];
  assertExecutionMatchesPlan(oldState, oldApproved, process.cwd());
  assert.equal(JSON.stringify(oldApproved), snapshot);
  assert.throws(() => createRequestPlan({ requestId: "invalid", goal: "Feature", profiles,
    tickets: [{ ticket_id: "task", project_id: "demo", goal: "Feature", risk: "bogus" }] }), /Risk must/);
});
