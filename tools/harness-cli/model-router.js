"use strict";

const MODEL_TIERS = Object.freeze(["fast", "standard", "strong"]);

const DEFAULT_MODELS = Object.freeze({
  openai: Object.freeze({
    fast: "gpt-6-luna",
    standard: "gpt-6.1-sol",
    strong: "gpt-6-astra"
  }),
  anthropic: Object.freeze({
    fast: "claude-haiku-5-5",
    standard: "claude-sonnet-5-5",
    strong: "claude-opus-5-5"
  }),
  gemini: Object.freeze({
    fast: "gemini-3.5-flash-lite",
    standard: "gemini-3.8-flash",
    strong: "gemini-4-argon"
  })
});

const TIER_ENV = Object.freeze({
  openai: Object.freeze({
    fast: "OPENAI_MODEL_FAST",
    standard: "OPENAI_MODEL",
    strong: "OPENAI_MODEL_STRONG"
  }),
  anthropic: Object.freeze({
    fast: "ANTHROPIC_MODEL_FAST",
    standard: "ANTHROPIC_MODEL",
    strong: "ANTHROPIC_MODEL_STRONG"
  }),
  gemini: Object.freeze({
    fast: "GEMINI_MODEL_FAST",
    standard: "GEMINI_MODEL",
    strong: "GEMINI_MODEL_STRONG"
  })
});

/**
 * 위험도 문자열을 표준 단계(low | medium | high)로 정규화한다.
 */
function normalizeRisk(value = "low") {
  const aliases = { low: "low", medium: "medium", high: "high", "낮음": "low", "보통": "medium", "높음": "high" };
  if (typeof value !== "string" || !Object.hasOwn(aliases, value.trim().toLowerCase())) throw new Error("Risk must be low, medium or high (낮음, 보통, 높음)");
  return aliases[value.trim().toLowerCase()];
}

/** Keep compatibility defaults distinguishable from an explicitly assessed risk. */
function ticketRiskMetadata(ticket) {
  const risk = normalizeRisk(ticket.risk);
  const source = ticket.risk_source ?? (ticket.risk === undefined ? "legacy-default" : "explicit");
  if (!["explicit", "legacy-default"].includes(source) || (source === "legacy-default" && risk !== "low")) throw new Error("Invalid risk_source");
  if (ticket.risk_reason !== undefined && typeof ticket.risk_reason !== "string") throw new Error("risk_reason must be a string");
  return { risk, risk_source: source, risk_reason: (ticket.risk_reason || "").trim() };
}

/** Shared runner-to-CLI role/type contract. */
function taskAgentOptions(ticket) {
  if (ticket.ticket_kind === "planning") return ["--type", "docs", "--role", "planner"];
  if (ticket.ticket_kind === "design") return ["--type", "architect", "--role", "architect"];
  return ["--type", "code", "--role", "implementer"];
}

/**
 * 업무 유형·중요도·위험도·재시도 횟수를 기반으로 모델 티어를 결정론적으로 선택한다.
 */
function resolveModelTier(options = {}) {
  const {
    type = "default",
    role = null,
    priority = null,
    risk = undefined,
    ticketKind = null,
    scopeCount = 0,
    attempt = 1,
    repairRequired = false,
    tierOverride = null
  } = options;

  if (tierOverride !== null && tierOverride !== undefined && String(tierOverride).trim() !== "") {
    const riskLevel = normalizeRisk(risk);
    const normalizedTier = String(tierOverride).trim().toLowerCase();
    if (!MODEL_TIERS.includes(normalizedTier)) {
      throw new Error(`Unsupported model tier: ${tierOverride}. Expected one of: ${MODEL_TIERS.join(", ")}`);
    }
    if (riskLevel === "high" && normalizedTier === "fast") throw new Error("High-risk work cannot use the fast model tier");
    return {
      tier: normalizedTier,
      base_tier: normalizedTier,
      reason: "explicit-tier-override",
      escalated: false
    };
  }

  const attemptNum = Number(attempt ?? 1);
  if (!Number.isInteger(attemptNum) || attemptNum < 1) {
    throw new Error(`Model routing attempt must be a positive integer: ${attempt}`);
  }

  const normPriority = String(priority || "").trim().toUpperCase();
  const riskLevel = normalizeRisk(risk);
  const effectiveScopeCount = Number.isFinite(Number(scopeCount)) ? Number(scopeCount) : 0;

  let baseTier = "standard";
  let baseReason = "standard-default";

  if (type === "architect" || role === "architect" || ticketKind === "design") {
    baseTier = "strong";
    baseReason = "architect-or-design-task";
  } else if (normPriority === "P0" || riskLevel === "high") {
    baseTier = "strong";
    baseReason = "high-risk-or-p0-priority";
  } else if (type === "review" || role === "reviewer") {
    baseTier = "standard";
    baseReason = "review-task-standard";
  } else if (normPriority === "P1" || riskLevel === "medium" || effectiveScopeCount > 3) {
    baseTier = "standard";
    baseReason = "elevated-priority-or-scope";
  } else if (type === "docs" || type === "code" || type === "fix" || ticketKind === "planning" || ticketKind === "development") {
    baseTier = "fast";
    baseReason = type === "docs" ? "docs-low-cost-tier" : "low-risk-cost-optimized";
  }

  if (repairRequired === true || attemptNum >= 2) {
    if (baseTier === "fast") {
      const nextTier = attemptNum >= 3 ? "strong" : "standard";
      return {
        tier: nextTier,
        base_tier: baseTier,
        reason: `retry-escalation-to-${nextTier}`,
        escalated: true
      };
    }
    if (baseTier === "standard" && attemptNum >= 3) {
      return {
        tier: "strong",
        base_tier: baseTier,
        reason: "retry-escalation-to-strong",
        escalated: true
      };
    }
  }

  return {
    tier: baseTier,
    base_tier: baseTier,
    reason: baseReason,
    escalated: false
  };
}

/**
 * 활성 Provider와 업무 조건을 바탕으로 최종 모델 및 선택 근거를 반환한다.
 */
function selectModelRoute(provider, options = {}, env = process.env) {
  if (!Object.hasOwn(DEFAULT_MODELS, provider)) {
    throw new Error(`Unsupported provider: ${provider}`);
  }
  const route = resolveModelTier(options);
  const envKey = TIER_ENV[provider][route.tier];
  const configured = typeof env[envKey] === "string" && env[envKey].trim() ? env[envKey].trim() : null;
  const model = configured || DEFAULT_MODELS[provider][route.tier];

  return {
    provider,
    tier: route.tier,
    base_tier: route.base_tier,
    model,
    reason: route.reason,
    escalated: route.escalated,
    source: configured ? "env" : "default"
  };
}

/**
 * 하위 호환용 모델 이름 선택 헬퍼.
 */
function selectModel(provider, type = "default", options = {}, env = process.env) {
  return selectModelRoute(provider, { ...options, type }, env).model;
}

module.exports = {
  DEFAULT_MODELS,
  MODEL_TIERS,
  TIER_ENV,
  normalizeRisk,
  ticketRiskMetadata,
  taskAgentOptions,
  resolveModelTier,
  selectModel,
  selectModelRoute
};
