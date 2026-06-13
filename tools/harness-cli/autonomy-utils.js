"use strict";

function simulateAutonomyRun(events, limits) {
  const state = {
    apiCalls: 0,
    completed: 0,
    retries: 0,
    status: "running"
  };

  for (const event of events) {
    if (state.completed >= limits.maxIterations || state.apiCalls >= limits.maxApiCalls) {
      state.status = "budget_exhausted";
      break;
    }
    if (event === "provider_request") state.apiCalls += 1;
    else if (event === "retryable_error") {
      state.apiCalls += 1;
      state.retries += 1;
      if (state.retries > limits.maxRetries) state.status = "provider_failed";
    } else if (event === "approval_required") {
      state.status = "approval_required";
      break;
    } else if (event === "verify_failed") {
      state.status = "failed_rolled_back";
      break;
    } else if (event === "ticket_completed") {
      state.completed += 1;
      state.retries = 0;
    }
    if (state.status !== "running") break;
  }

  if (state.status === "running") {
    state.status = state.completed >= limits.maxIterations || state.apiCalls >= limits.maxApiCalls
      ? "budget_exhausted"
      : "idle";
  }
  return state;
}

function runAutonomySoak(cycles = 1000) {
  const limits = { maxIterations: 3, maxApiCalls: 6, maxRetries: 3 };
  const scenarios = [
    ["provider_request", "ticket_completed", "provider_request", "ticket_completed", "provider_request", "ticket_completed"],
    ["retryable_error", "retryable_error", "provider_request", "ticket_completed"],
    ["provider_request", "approval_required"],
    ["provider_request", "verify_failed"],
    ["provider_request", "ticket_completed", "provider_request", "ticket_completed", "provider_request", "ticket_completed", "provider_request"]
  ];

  for (let index = 0; index < cycles; index += 1) {
    const result = simulateAutonomyRun(scenarios[index % scenarios.length], limits);
    if (result.apiCalls > limits.maxApiCalls || result.completed > limits.maxIterations) {
      throw new Error(`Autonomy budget invariant failed at cycle ${index}.`);
    }
    if (!["idle", "budget_exhausted", "approval_required", "failed_rolled_back", "provider_failed"].includes(result.status)) {
      throw new Error(`Unexpected autonomy terminal state at cycle ${index}: ${result.status}`);
    }
  }
  return { cycles, scenarios: scenarios.length };
}

module.exports = {
  runAutonomySoak,
  simulateAutonomyRun
};
