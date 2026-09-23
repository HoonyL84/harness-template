"use strict";

const crypto = require("node:crypto");
const path = require("node:path");
const { readJson, updateJsonLocked } = require("./control-plane-state");
const { readBoundedJson } = require("./jira-input");
const METRIC = "serviceruntime.googleapis.com/api/request_count";

async function readGeminiUsage({ root, env, fetchImpl, now, start, end, refresh }) {
  const project = env.GOOGLE_CLOUD_PROJECT, token = env.GOOGLE_CLOUD_ACCESS_TOKEN;
  const cost = { status: "not-configured", value: null, reason: "Cloud Billing export is separate; no billing export or chargeable query is created automatically" };
  if (!project || !token) return { status: "missing-monitoring-credential", required_env: ["GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_ACCESS_TOKEN"], cost };
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) return { status: "invalid-project", cost };
  if (["true", "1"].includes(env.HARNESS_OFFLINE)) return { status: "offline", cost };
  const file = path.join(root, ".harness", "local", "gemini-account-usage.json");
  const cacheKey = crypto.createHash("sha256").update(JSON.stringify([project, token, start, end, METRIC])).digest("hex");
  try {
    const cached = readJson(file, {})[cacheKey];
    if (!refresh && cached && now() >= cached.at && now() - cached.at < 300000) return { status: "partial", usage: { ...cached.result, cached: true, fetched_at: new Date(cached.at).toISOString() }, cost };
    let count = 0, pointCount = 0, cursor = null;
    const seen = new Set(), points = new Set();
    for (let page = 0; page < 20; page++) {
      const url = new URL(`https://monitoring.googleapis.com/v3/projects/${project}/timeSeries`);
      url.searchParams.set("filter", `metric.type="${METRIC}" AND resource.type="consumed_api" AND resource.labels.service="generativelanguage.googleapis.com" AND resource.labels.project_id="${project}"`);
      url.searchParams.set("interval.startTime", new Date(start).toISOString());
      url.searchParams.set("interval.endTime", new Date(end).toISOString());
      // Aggregate each series by UTC day before pagination; raw minute samples grow quickly.
      url.searchParams.set("aggregation.alignmentPeriod", "86400s");
      url.searchParams.set("aggregation.perSeriesAligner", "ALIGN_SUM");
      url.searchParams.set("view", "FULL"); url.searchParams.set("pageSize", "500");
      if (cursor) url.searchParams.set("pageToken", cursor);
      const response = await fetchImpl(url.href, { method: "GET", headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: globalThis.AbortSignal.timeout(15000) });
      if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error("Monitoring HTTP failure"), { status: response.status }); }
      const body = await readBoundedJson(response);
      if (!body || typeof body !== "object" || Array.isArray(body) || (body.timeSeries !== undefined && !Array.isArray(body.timeSeries))
          || body.executionErrors?.length || body.unreachable?.length) throw new Error("Incomplete monitoring response");
      for (const series of body.timeSeries || []) {
        if (series.metric?.type !== METRIC || series.resource?.type !== "consumed_api" || series.resource.labels?.project_id !== project
            || series.resource.labels.service !== "generativelanguage.googleapis.com" || series.metricKind !== "DELTA" || series.valueType !== "INT64"
            || !Array.isArray(series.points)) throw new Error("Invalid monitoring series");
        const labels = value => Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b));
        const identity = JSON.stringify([labels(series.metric.labels), labels(series.resource.labels)]);
        for (const point of series.points) {
          const value = point.value?.int64Value;
          const from = Date.parse(point.interval?.startTime), to = Date.parse(point.interval?.endTime);
          if (typeof value !== "string" || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))
              || !Number.isFinite(from) || !Number.isFinite(to) || from >= to || from < start || to > end) throw new Error("Invalid or boundary-overlapping monitoring point");
          const id = `${identity}:${from}:${to}`;
          if (points.has(id)) throw new Error("Duplicate monitoring point");
          points.add(id); count += Number(value); pointCount++;
          if (!Number.isSafeInteger(count)) throw new Error("Request total overflow");
        }
      }
      if (!body.nextPageToken) break;
      cursor = body.nextPageToken;
      if (typeof cursor !== "string" || seen.has(cursor) || page === 19) throw new Error("Monitoring pagination incomplete");
      seen.add(cursor);
    }
    const result = { status: pointCount ? "available" : "no-data", requests: pointCount ? count : null, unit: "requests", project,
      scope: "Project-wide completed Gemini Developer API requests, including failures; not tokens or remaining quota",
      source: "Google Cloud Monitoring", reporting_delay: "Metrics may be delayed up to 30 minutes" };
    const at = now();
    updateJsonLocked(file, {}, state => ({ ...Object.fromEntries(Object.entries(state).filter(([, v]) => at - v.at < 300000)), [cacheKey]: { result, at } }));
    return { status: "partial", usage: { ...result, cached: false, fetched_at: new Date(at).toISOString() }, cost };
  } catch (error) {
    return { status: "partial-or-unavailable", cost, usage: { status: [401, 403].includes(error.status) ? "permission-denied" : "unavailable", value: null,
      reason: error.status ? `HTTP ${error.status}; check Monitoring read permission and OAuth token expiry` : "Network, response, pagination or persistence failed" } };
  }
}
module.exports = { readGeminiUsage };
