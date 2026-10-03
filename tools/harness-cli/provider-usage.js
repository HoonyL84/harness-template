"use strict";

const path = require("node:path");
const { costMeter, loadPricing, estimateCost } = require("./observed-cost");
const { readJson, updateJsonLocked, writeJsonAtomic } = require("./control-plane-state");

const PROVIDERS = Object.freeze(["openai", "anthropic", "gemini"]);
const KEY_ENV = Object.freeze({
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY"
});
const MODEL_ENV = Object.freeze({
  openai: "OPENAI_MODEL",
  anthropic: "ANTHROPIC_MODEL",
  gemini: "GEMINI_MODEL"
});
const BUDGET_ENV = Object.freeze({
  openai: "HARNESS_OPENAI_MONTHLY_TOKEN_BUDGET",
  anthropic: "HARNESS_ANTHROPIC_MONTHLY_TOKEN_BUDGET",
  gemini: "HARNESS_GEMINI_MONTHLY_TOKEN_BUDGET"
});
const REMOTE_USAGE_REASON = Object.freeze({
  openai: "OpenAI organization usage requires a separate admin credential.",
  anthropic: "Anthropic organization usage requires a separate Admin API credential.",
  gemini: "Gemini account usage requires Google Cloud monitoring and billing permissions."
});

function asNonNegativeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function normalizeUsage(provider, response = {}) {
  const usage = response.usage || response.usageMetadata || {};
  if (provider === "openai") {
    const inputTokens = asNonNegativeNumber(usage.prompt_tokens);
    const outputTokens = asNonNegativeNumber(usage.completion_tokens);
    const cachedTokens = asNonNegativeNumber(usage.prompt_tokens_details?.cached_tokens);
    return {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_tokens: cachedTokens,
      total_tokens: asNonNegativeNumber(usage.total_tokens || inputTokens + outputTokens)
    };
  }
  if (provider === "anthropic") {
    const inputTokens = asNonNegativeNumber(usage.input_tokens);
    const outputTokens = asNonNegativeNumber(usage.output_tokens);
    const cachedTokens = asNonNegativeNumber(usage.cache_creation_input_tokens)
      + asNonNegativeNumber(usage.cache_read_input_tokens);
    return {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_tokens: cachedTokens,
      total_tokens: inputTokens + outputTokens + cachedTokens
    };
  }
  if (provider === "gemini") {
    const inputTokens = asNonNegativeNumber(usage.promptTokenCount);
    const outputTokens = asNonNegativeNumber(usage.candidatesTokenCount);
    const cachedTokens = asNonNegativeNumber(usage.cachedContentTokenCount);
    return {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
      cached_tokens: cachedTokens,
      total_tokens: asNonNegativeNumber(usage.totalTokenCount || inputTokens + outputTokens)
    };
  }
  throw new Error(`Unsupported provider: ${provider}`);
}

function parseBudget(value) {
  if (value === undefined || value === null || String(value).trim() === "") return null;
  const budget = Number(value);
  if (!Number.isSafeInteger(budget) || budget <= 0) return null;
  return budget;
}

function createProviderUsageService({ root, env = process.env, now = () => new Date(), isPlaceholder = (value) => !value }) {
  const usageFile = path.join(root, "observability", "provider-usage", "usage.json");
  const providerFile = path.join(root, ".harness", "local", "provider.json");

  function activeProvider() {
    const selected = readJson(providerFile, {}).provider;
    const provider = selected || env.AI_PROVIDER || "openai";
    if (!PROVIDERS.includes(provider)) throw new Error(`Unsupported provider: ${provider}`);
    return provider;
  }

  function isConfigured(provider) {
    return !isPlaceholder(env[KEY_ENV[provider]]);
  }

  function use(provider) {
    if (!PROVIDERS.includes(provider)) throw new Error(`Unsupported provider: ${provider}`);
    if (!isConfigured(provider)) throw new Error(`${KEY_ENV[provider]} is missing or placeholder`);
    writeJsonAtomic(providerFile, {
      schema_version: "1.0",
      provider,
      updated_at: now().toISOString()
    });
    return provider;
  }

  function record(provider, model, response, attribution = null) {
    if (!PROVIDERS.includes(provider)) throw new Error(`Unsupported provider: ${provider}`);
    if (attribution && !["project_id", "request_id", "ticket_id"].every(key => typeof attribution[key] === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(attribution[key]))) throw new Error("Invalid ticket usage attribution");
    const timestamp = now();
    const month = timestamp.toISOString().slice(0, 7);
    const normalized = normalizeUsage(provider, response);
    updateJsonLocked(usageFile, { schema_version: "1.0", months: {} }, (state) => {
      state.months ||= {};
      state.months[month] ||= { providers: {} };
      const current = state.months[month].providers[provider] || {
        requests: 0,
        input_tokens: 0,
        output_tokens: 0,
        cached_tokens: 0,
        total_tokens: 0,
        models: {}
      };
      current.cost_meters ||= {};
      const sampled = costMeter(provider, response), meter = current.cost_meters[model] || { input_tokens: 0, output_tokens: 0, cached_tokens: 0, complete: !Object.hasOwn(current.models, model) };
      for (const field of ["input_tokens", "output_tokens", "cached_tokens"]) meter[field] += sampled[field];
      meter.complete &&= sampled.complete && ["input_tokens", "output_tokens", "cached_tokens"].every(field => Number.isSafeInteger(meter[field]) && meter[field] >= 0);
      current.cost_meters[model] = meter;
      current.requests += 1;
      current.input_tokens += normalized.input_tokens;
      current.output_tokens += normalized.output_tokens;
      current.cached_tokens += normalized.cached_tokens;
      current.total_tokens += normalized.total_tokens;
      current.models[model] = (current.models[model] || 0) + normalized.total_tokens;
      current.last_used_at = timestamp.toISOString();
      state.months[month].providers[provider] = current;
      if (attribution) {
        const key = `${attribution.project_id}:${attribution.request_id}:${attribution.ticket_id}`;
        state.months[month].tickets ||= {};
        const ticket = state.months[month].tickets[key] || { responses: 0, total_tokens: 0, complete: true };
        const usage = response?.usage || response?.usageMetadata;
        const rawTotal = usage?.total_tokens ?? usage?.totalTokenCount;
        const input = usage?.prompt_tokens ?? usage?.input_tokens ?? usage?.promptTokenCount;
        const output = usage?.completion_tokens ?? usage?.output_tokens ?? usage?.candidatesTokenCount;
        const known = value => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
        ticket.complete &&= known(rawTotal) || known(input) && known(output);
        ticket.responses++; ticket.total_tokens += normalized.total_tokens;
        state.months[month].tickets[key] = ticket;
      }
      return state;
    });
    return normalized;
  }

  function status({ cost = false } = {}) {
    const pricing = cost ? loadPricing(root) : null;
    const timestamp = now();
    const month = timestamp.toISOString().slice(0, 7);
    const state = readJson(usageFile, { schema_version: "1.0", months: {} });
    const observed = state.months?.[month]?.providers || {};
    const selected = activeProvider();
    return {
      schema_version: "1.0",
      generated_at: timestamp.toISOString(),
      month,
      active_provider: selected,
      providers: PROVIDERS.map((provider) => {
        const usage = observed[provider] || {
          requests: 0,
          input_tokens: 0,
          output_tokens: 0,
          cached_tokens: 0,
          total_tokens: 0,
          models: {}
        };
        const budget = parseBudget(env[BUDGET_ENV[provider]]);
        const remaining = budget === null ? null : Math.max(0, budget - usage.total_tokens);
        return {
          provider,
          active: provider === selected,
          configured: isConfigured(provider),
          model: env[MODEL_ENV[provider]] || null,
          observed_usage: usage,
          ...(cost ? { estimated_cost: estimateCost(provider, usage, pricing, month, timestamp) } : {}),
          monthly_token_budget: budget,
          remaining_tokens: remaining,
          remaining_percent: budget === null ? null : Number(((remaining / budget) * 100).toFixed(2)),
          remote_account_remaining: {
            status: "unknown",
            reason: REMOTE_USAGE_REASON[provider]
          }
        };
      })
    };
  }

  return { activeProvider, record, status, use };
}

module.exports = {
  PROVIDERS,
  createProviderUsageService,
  normalizeUsage
};
