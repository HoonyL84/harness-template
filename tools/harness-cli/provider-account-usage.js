"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { readJson, updateJsonLocked } = require("./control-plane-state");
const { readBoundedJson } = require("./jira-input");
const { readGeminiUsage } = require("./gemini-account-usage");

const SPECS = {
  openai: { key: "OPENAI_ADMIN_KEY", base: "https://api.openai.com/v1/organization/", usage: "usage/completions", cost: "costs" },
  anthropic: { key: "ANTHROPIC_ADMIN_KEY", base: "https://api.anthropic.com/v1/organizations/", usage: "usage_report/messages", cost: "cost_report" }
};
function dateOnly(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("Use YYYY-MM-DD UTC dates");
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw new Error("Invalid calendar date");
  return time;
}
function numeric(value) {
  if ((typeof value !== "number" && (typeof value !== "string" || !/^-?\d+(\.\d+)?$/.test(value))) || !Number.isFinite(Number(value))) throw new Error("Invalid usage amount");
  return Number(value);
}
function normalizeRows(provider, metric, rows) {
  if (metric === "cost") {
    const totals = {};
    for (const row of rows) {
      const currency = provider === "openai" ? row.amount?.currency : row.currency;
      if (typeof currency !== "string" || !/^[a-z]{3}$/i.test(currency)) throw new Error("Missing cost currency");
      const value = numeric(provider === "openai" ? row.amount?.value : row.amount);
      if (provider === "anthropic" && currency.toUpperCase() !== "USD") throw new Error("Unsupported Anthropic currency unit");
      totals[currency.toUpperCase()] = (totals[currency.toUpperCase()] || 0) + value / (provider === "anthropic" ? 100 : 1);
    }
    return { status: "available", totals, unit: "currency-major-unit", scope: "organization costs; not a credit balance" };
  }
  let input = 0, output = 0;
  for (const row of rows) {
    const count = value => { const n = numeric(value); if (!Number.isSafeInteger(n) || n < 0) throw new Error("Invalid token count"); return n; };
    input += provider === "openai" ? count(row.input_tokens) : count(row.uncached_input_tokens)
      + count(row.cache_read_input_tokens) + count(row.cache_creation?.ephemeral_1h_input_tokens) + count(row.cache_creation?.ephemeral_5m_input_tokens);
    output += count(row.output_tokens);
  }
  return { status: "available", input_tokens: input, output_tokens: output, total_tokens: input + output,
    unit: "tokens", scope: provider === "openai" ? "organization completions (not all API products)" : "organization messages (not subscription quota)" };
}

function createAccountUsage({ root, env = process.env, fetchImpl = globalThis.fetch, now = () => Date.now() }) {
  const file = path.join(root, ".harness", "local", "provider-account-usage.json");
  return async ({ from, to, provider, refresh = false } = {}) => {
    const end = dateOnly(to || new Date(now()).toISOString().slice(0, 10));
    const start = dateOnly(from || new Date(end - 7 * 86400000).toISOString().slice(0, 10));
    if (start >= end || end > now() || end - start > 90 * 86400000) throw new Error("Use a past 1-90 day range; --to is exclusive UTC midnight");
    if (provider && !["openai", "anthropic", "gemini"].includes(provider)) throw new Error("Unknown account usage provider");
    const report = { from: new Date(start).toISOString(), to_exclusive: new Date(end).toISOString(), providers: [] };
    for (const name of provider ? [provider] : ["openai", "anthropic", "gemini"]) {
      const spec = SPECS[name];
      const item = { provider: name, actual_remaining: { status: "unknown", value: null, reason: "Usage/cost reports are not remaining subscription quota or prepaid credit" } };
      report.providers.push(item);
      if (name === "gemini") {
        Object.assign(item, await readGeminiUsage({ root, env, fetchImpl, now, start, end, refresh }));
        continue;
      }
      if (!env[spec.key]) { item.status = "missing-admin-credential"; item.required_env = spec.key; continue; }
      if (["true", "1"].includes(env.HARNESS_OFFLINE)) { item.status = "offline"; continue; }
      for (const metric of ["usage", "cost"]) {
        const cacheKey = crypto.createHash("sha256").update(JSON.stringify([name, metric, start, end, env[spec.key]])).digest("hex");
        const cached = readJson(file, {})[cacheKey];
        if (!refresh && cached && now() >= cached.fetched_at && now() - cached.fetched_at < 300000) { item[metric] = { ...cached.result, cached: true, fetched_at: new Date(cached.fetched_at).toISOString() }; continue; }
        try {
          const rows = [], seen = new Set();
          let cursor = null;
          for (let page = 0; page < 20; page++) {
            const url = new URL(spec.base + spec[metric]);
            if (name === "openai") { url.searchParams.set("start_time", start / 1000); url.searchParams.set("end_time", end / 1000); }
            else { url.searchParams.set("starting_at", new Date(start).toISOString()); url.searchParams.set("ending_at", new Date(end).toISOString()); }
            if (metric === "usage") url.searchParams.set("bucket_width", "1d");
            if (cursor) url.searchParams.set("page", cursor);
            const response = await fetchImpl(url.href, { method: "GET", redirect: "error", signal: globalThis.AbortSignal.timeout(15000),
              headers: name === "openai" ? { Authorization: `Bearer ${env[spec.key]}` }
                : { "x-api-key": env[spec.key], "anthropic-version": "2023-06-01" } });
            if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error("Account usage HTTP failure"), { status: response.status }); }
            const body = await readBoundedJson(response);
            if (!Array.isArray(body.data) || typeof body.has_more !== "boolean") throw new Error("Invalid usage page");
            for (const bucket of body.data) {
              if (!Array.isArray(bucket.results)) throw new Error("Invalid usage bucket");
              rows.push(...bucket.results);
            }
            if (!body.has_more) break;
            cursor = body.next_page;
            if (typeof cursor !== "string" || !cursor || seen.has(cursor) || page === 19) throw new Error("Usage pagination is incomplete");
            seen.add(cursor);
          }
          const result = normalizeRows(name, metric, rows), fetchedAt = now();
          updateJsonLocked(file, {}, state => ({ ...Object.fromEntries(Object.entries(state).filter(([, v]) => fetchedAt - v.fetched_at < 300000)),
            [cacheKey]: { result, fetched_at: fetchedAt } }));
          item[metric] = { ...result, cached: false, fetched_at: new Date(fetchedAt).toISOString() };
        } catch (error) {
          item[metric] = { status: error.status === 401 || error.status === 403 ? "permission-denied" : "unavailable", value: null,
            reason: error.status ? `HTTP ${error.status}` : "Network, response schema, pagination or local persistence failed" };
        }
      }
      item.status = [item.usage, item.cost].every(value => value.status === "available") ? "available" : "partial-or-unavailable";
    }
    return report;
  };
}
module.exports = { createAccountUsage, normalizeRows };
