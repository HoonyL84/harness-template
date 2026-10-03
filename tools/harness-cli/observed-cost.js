"use strict";
const fs = require("node:fs");
const path = require("node:path");
const known = n => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
/** Collect billable token categories, preserving missing/unsupported usage as incomplete. */
function costMeter(provider, response = {}) {
  const u = response.usage || response.usageMetadata || {};
  const input = provider === "openai" ? u.prompt_tokens : provider === "anthropic" ? u.input_tokens : u.promptTokenCount;
  const rawOutput = provider === "openai" ? u.completion_tokens : provider === "anthropic" ? u.output_tokens : u.candidatesTokenCount;
  const thoughts = provider === "gemini" ? u.thoughtsTokenCount ?? 0 : 0;
  const cached = provider === "openai" ? u.prompt_tokens_details?.cached_tokens ?? 0 : provider === "anthropic" ? u.cache_read_input_tokens ?? 0 : u.cachedContentTokenCount ?? 0;
  const creation = provider === "anthropic" ? u.cache_creation_input_tokens ?? 0 : provider === "openai" ? u.prompt_tokens_details?.cache_write_tokens ?? 0 : 0;
  const total = provider === "openai" ? u.total_tokens : provider === "gemini" ? u.totalTokenCount : undefined;
  const complete = [input, rawOutput, thoughts, cached, creation].every(known) && creation === 0
    && known(input + rawOutput + thoughts)
    && (provider === "anthropic" || cached <= input)
    && (total === undefined || known(total) && total === input + rawOutput + thoughts);
  return { input_tokens: known(input) ? input : 0, output_tokens: known(rawOutput) && known(thoughts) ? rawOutput + thoughts : 0,
    cached_tokens: known(cached) ? cached : 0, complete };
}
function loadPricing(root) {
  const file = path.join(root, ".harness/local/pricing.json");
  if (!fs.existsSync(file)) return null;
  let current = root;
  for (const segment of [".harness", "local", "pricing.json"]) {
    current = path.join(current, segment);
    if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Invalid pricing: symbolic link/junction");
  }
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > 65536) throw new Error("Invalid pricing file size");
  let data;
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("Invalid pricing JSON"); }
  if (data?.schema_version !== "1.0" || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test(data.month) || !data.models || Array.isArray(data.models) || typeof data.models !== "object") throw new Error("Invalid pricing schema");
  for (const [provider, models] of Object.entries(data.models)) {
    if (!["openai", "anthropic", "gemini"].includes(provider) || !models || Array.isArray(models) || typeof models !== "object") throw new Error("Invalid pricing provider");
    for (const rate of Object.values(models)) {
      let source;
      try { source = new URL(rate.source); } catch { throw new Error("Invalid pricing source"); }
      if (source.protocol !== "https:" || source.username || source.password || source.search || source.hash
          || !["openai.com", "platform.openai.com", "anthropic.com", "www.anthropic.com", "claude.com", "docs.claude.com", "platform.claude.com", "ai.google.dev", "cloud.google.com"].includes(source.hostname)
          || !/^\d{4}-\d{2}-\d{2}$/.test(rate.as_of) || !Number.isFinite(Date.parse(rate.as_of)) || new Date(rate.as_of).toISOString().slice(0, 10) !== rate.as_of
          || !["input_per_million", "output_per_million", "cached_input_per_million"].every(k => typeof rate[k] === "number" && Number.isFinite(rate[k]) && rate[k] >= 0)) throw new Error("Invalid pricing rate/source/date");
    }
  }
  return data;
}
/** A supplied price snapshot is reference data, not an authenticated billing statement. */
function estimateCost(provider, usage, pricing, month, now) {
  const result = { status: "unknown", usd: null, known_subtotal_usd: 0, models: [], scope: "harness-observed-token-inference-only", notice: "Reference estimate, not account balance or invoice. Excludes unobserved requests, storage, discounts, taxes and batch/long-context pricing." };
  const round = n => Number(n.toFixed(10));
  let complete = true;
  const models = Object.keys(usage.models || {});
  if (!models.length) return { ...result, reason: "no-observed-model-usage" };
  for (const model of models) {
    const meter = usage.cost_meters?.[model], rate = pricing?.month === month ? pricing.models?.[provider]?.[model] : null;
    const age = rate ? now.getTime() - Date.parse(rate.as_of) : NaN;
    const valid = meter?.complete === true && rate && age >= 0 && age <= 90 * 86400000;
    if (!valid) { complete = false; result.models.push({ model, status: "unknown", usd: null, reason: "missing/incomplete usage, price or applicable/current price snapshot" }); continue; }
    const uncached = provider === "anthropic" ? meter.input_tokens : meter.input_tokens - meter.cached_tokens;
    const usd = (uncached * rate.input_per_million + meter.output_tokens * rate.output_per_million + meter.cached_tokens * rate.cached_input_per_million) / 1000000;
    if (!Number.isFinite(usd) || usd < 0 || !Number.isFinite(result.known_subtotal_usd + usd)) { complete = false; result.models.push({ model, status: "unknown", usd: null }); continue; }
    result.known_subtotal_usd += usd;
    result.models.push({ model, status: "estimated", usd: round(usd), source: rate.source, as_of: rate.as_of });
  }
  result.known_subtotal_usd = round(result.known_subtotal_usd);
  if (complete) { result.status = "estimated"; result.usd = result.known_subtotal_usd; }
  return result;
}
module.exports = { costMeter, loadPricing, estimateCost };
