"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createProviderUsageService, normalizeUsage } = require("../../tools/harness-cli/provider-usage");

const fixedNow = () => new Date("2026-09-01T00:00:00.000Z");
const placeholder = (value) => !value || value.endsWith("...");

test("provider usage normalizes OpenAI, Anthropic, and Gemini responses", () => {
  assert.deepEqual(normalizeUsage("openai", {
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 3 } }
  }), { input_tokens: 10, output_tokens: 5, cached_tokens: 3, total_tokens: 15 });
  assert.deepEqual(normalizeUsage("anthropic", {
    usage: { input_tokens: 7, output_tokens: 4, cache_creation_input_tokens: 2, cache_read_input_tokens: 3 }
  }), { input_tokens: 7, output_tokens: 4, cached_tokens: 5, total_tokens: 16 });
  assert.deepEqual(normalizeUsage("gemini", {
    usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 6, cachedContentTokenCount: 2, totalTokenCount: 14 }
  }), { input_tokens: 8, output_tokens: 6, cached_tokens: 2, total_tokens: 14 });
});

test("provider usage persists observed tokens and calculates configured budget", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-provider-"));
  const env = {
    AI_PROVIDER: "openai",
    OPENAI_API_KEY: "openai-key",
    OPENAI_MODEL: "test-model",
    HARNESS_OPENAI_MONTHLY_TOKEN_BUDGET: "100"
  };
  const service = createProviderUsageService({ root, env, now: fixedNow, isPlaceholder: placeholder });
  service.record("openai", "test-model", { usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } });
  const report = service.status();
  const openai = report.providers.find((item) => item.provider === "openai");
  assert.equal(openai.observed_usage.total_tokens, 30);
  assert.equal(openai.remaining_tokens, 70);
  assert.equal(openai.remaining_percent, 70);
  assert.equal(openai.remote_account_remaining.status, "unknown");
});

test("provider switching only accepts configured keys and never persists secrets", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-provider-"));
  const env = { AI_PROVIDER: "openai", OPENAI_API_KEY: "openai-key", ANTHROPIC_API_KEY: "anthropic-key" };
  const service = createProviderUsageService({ root, env, now: fixedNow, isPlaceholder: placeholder });
  assert.equal(service.use("anthropic"), "anthropic");
  assert.equal(service.activeProvider(), "anthropic");
  const state = fs.readFileSync(path.join(root, ".harness", "local", "provider.json"), "utf8");
  assert.equal(state.includes("anthropic-key"), false);
  assert.throws(() => service.use("gemini"), /GEMINI_API_KEY/);
});
