"use strict";

const { readBoundedJson } = require("./jira-input");
const SPECS = {
  openai: { key: "OPENAI_API_KEY", url: "https://api.openai.com/v1/models", field: "data" },
  anthropic: { key: "ANTHROPIC_API_KEY", url: "https://api.anthropic.com/v1/models?limit=1", field: "data" },
  gemini: { key: "GEMINI_API_KEY", url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1", field: "models" }
};

async function checkProviders({ provider, env = process.env, fetchImpl = globalThis.fetch,
  isPlaceholder = value => !value || value.includes("...") } = {}) {
  if (provider && !Object.hasOwn(SPECS, provider)) throw new Error("Unknown provider; use openai, anthropic or gemini");
  const report = { providers: [], notice: "Read-only model catalog checks; no generation. This does not verify model inference permission, credit balance or subscription quota." };
  for (const name of provider ? [provider] : Object.keys(SPECS)) {
    const spec = SPECS[name], key = env[spec.key], item = { provider: name, required_env: spec.key };
    report.providers.push(item);
    if (isPlaceholder(key)) { item.status = "missing-key"; continue; }
    if (["true", "1"].includes(env.HARNESS_OFFLINE)) { item.status = "offline"; continue; }
    try {
      const headers = name === "openai" ? { Authorization: `Bearer ${key}` } : name === "anthropic"
        ? { "x-api-key": key, "anthropic-version": "2023-06-01" } : { "x-goog-api-key": key };
      const response = await fetchImpl(spec.url, { method: "GET", headers, redirect: "error", signal: globalThis.AbortSignal.timeout(15000) });
      if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error("Provider HTTP failure"), { status: response.status }); }
      const body = await readBoundedJson(response);
      if (!Array.isArray(body[spec.field])) throw new Error("Invalid model catalog");
      item.status = "connected";
      item.scope = "model-catalog-read";
    } catch (error) {
      item.status = [401, 403].includes(error.status) ? "permission-denied" : "unavailable";
      item.reason = error.status ? `HTTP ${error.status}` : "Network or response validation failed";
    }
  }
  return report;
}
module.exports = { checkProviders };
