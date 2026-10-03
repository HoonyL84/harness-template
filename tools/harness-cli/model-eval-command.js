"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { writeJsonAtomic, updateJsonLocked } = require("./control-plane-state");
const { SYSTEM, grade, hash, observedUsage } = require("./model-eval-oracle");
const MAX_OUTPUT_TOKENS = 4096;
const MAX_STATE_BYTES = 2 * 1024 * 1024;
const ID = /^eval-[a-f0-9-]{36}$/;
function resultFingerprint(record) {
  const { review: _review, review_history: _history, review_history_fingerprint: _historyFp, result_fingerprint: _fp, ...evidence } = record;
  return hash(JSON.stringify(evidence));
}
function summarize(record) {
  const attempts = record.cases.flatMap(c => c.attempts);
  return { id: record.id, provider: record.provider, model: record.model, status: record.status,
    passed: record.cases.filter(c => c.status === "PASS").length, total: record.cases.length,
    attempts: attempts.length, retries: record.cases.reduce((n, c) => n + Math.max(0, c.attempts.length - 1), 0),
    latency_ms: attempts.reduce((n, a) => n + (a.latency_ms || 0), 0),
    observed_total_tokens: attempts.length && attempts.every(a => a.usage?.total_tokens !== null && a.usage?.total_tokens !== undefined)
      ? attempts.reduce((n, a) => n + a.usage.total_tokens, 0) : null,
    cost_usd: null, human_review: record.review?.result || "pending", review_count: record.review_history?.length ?? (record.review ? 1 : 0), result_fingerprint: record.result_fingerprint };
}
function createModelEvalCommand({ root, parseArgs, log, invokeAgent, env = process.env, now = () => Date.now() }) {
  const directory = path.join(root, ".harness/local/evals");
  function bank() {
    const file = path.join(root, "evals/regression/ticket-cases.json");
    if (fs.statSync(file).size > 65536) throw new Error("Eval case bank exceeds 64KB");
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (value.schema_version !== "1.0" || !Array.isArray(value.cases) || value.cases.length < 1 || value.cases.length > 9
        || new Set(value.cases.map(c => c.id)).size !== value.cases.length
        || !value.cases.every(c => /^[a-z0-9-]+$/.test(c.id) && typeof c.input === "string" && c.input.trim() && ["DRAFT", "BLOCKED"].includes(c.expected?.status)
          && (c.expected.status === "BLOCKED" ? Array.isArray(c.expected.missing) : Array.isArray(c.expected.projects) && Array.isArray(c.expected.commands)))) throw new Error("Invalid eval case bank");
    return value.cases;
  }
  function fileFor(id) {
    if (!ID.test(id || "")) throw new Error("Invalid eval run ID");
    for (const p of [path.join(root, ".harness"), path.join(root, ".harness/local"), directory]) {
      if (fs.existsSync(p) && fs.lstatSync(p).isSymbolicLink()) throw new Error("Eval storage cannot use symlink/junction paths");
      if (!fs.existsSync(p)) fs.mkdirSync(p);
    }
    return path.join(directory, `${id}.json`);
  }
  function checked(value, id) {
    if (!value || value.id !== id || !["COMPLETE", "INCOMPLETE", "RUNNING"].includes(value.status) || !Array.isArray(value.cases)
        || value.result_fingerprint !== resultFingerprint(value)) throw new Error("Eval evidence changed or invalid");
    if (value.review && value.review.fingerprint !== value.result_fingerprint) throw new Error("Stale eval human review");
    if (value.review_history !== undefined) {
      const history = value.review_history;
      if (!Array.isArray(history) || value.review_history_fingerprint !== hash(JSON.stringify(history))
          || history.some(entry => !entry || entry.fingerprint !== value.result_fingerprint || !["accepted", "changes-requested"].includes(entry.result)
            || typeof entry.reason !== "string" || !entry.reason.trim() || !Number.isFinite(Date.parse(entry.at)))
          || JSON.stringify(history.at(-1) || null) !== JSON.stringify(value.review || null)) throw new Error("Eval review history changed or invalid");
    }
    return value;
  }
  function read(id) {
    const file = fileFor(id), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STATE_BYTES) throw new Error("Invalid eval evidence file");
    return checked(JSON.parse(fs.readFileSync(file, "utf8")), id);
  }
  function save(record) {
    record.result_fingerprint = resultFingerprint(record);
    if (Buffer.byteLength(JSON.stringify(record)) > MAX_STATE_BYTES) throw new Error("Eval evidence exceeds size limit");
    writeJsonAtomic(fileFor(record.id), record);
  }
  return async function commandModelEval(argv) {
    const { positional, options } = parseArgs(argv);
    const command = positional[0];
    const allowed = { list: [], run: ["provider", "model", "cases", "live", "max-requests", "max-attempts"], show: [], compare: [], review: ["fingerprint", "result", "reason", "minutes"] };
    if (!allowed[command] || Object.keys(options).some(k => !allowed[command].includes(k))) throw new Error("Invalid eval command/options");
    if (["list", "run"].includes(command) && positional.length !== 1 || ["show", "review"].includes(command) && positional.length !== 2) throw new Error("Invalid eval arguments");
    const emit = value => { log(JSON.stringify(value, null, 2)); return value; };
    if (command === "list") return emit({ cases: bank(), limitation: "Structural/boundary oracles only; not semantic correctness or a model ranking." });
    if (command === "show") return emit(read(positional[1]));
    if (command === "compare") {
      const ids = positional.slice(1).flatMap(v => v.split(","));
      if (ids.length < 2 || ids.length > 20 || new Set(ids).size !== ids.length) throw new Error("Compare requires 2..20 unique run IDs");
      const records = ids.map(read);
      if (records.some(r => r.status !== "COMPLETE" || r.cohort_fingerprint !== records[0].cohort_fingerprint || r.provenance !== records[0].provenance)) throw new Error("Only completed runs with identical cases/policy/provenance can be compared");
      return emit({ cohort: records[0].cohort_fingerprint, runs: records.map(summarize), limitation: "No automatic winner. Human semantic review and repeated live trials remain necessary." });
    }
    if (command === "review") {
      const id = positional[1];
      read(id);
      if (!["accepted", "changes-requested"].includes(options.result) || typeof options.reason !== "string" || !options.reason.trim() || options.reason.length > 2000) throw new Error("Review requires a result and reason (1..2000 chars)");
      const minutes = options.minutes === undefined ? null : Number(options.minutes);
      if (minutes !== null && (!Number.isFinite(minutes) || minutes < 0 || minutes > 10000)) throw new Error("Review minutes must be 0..10000");
      const record = updateJsonLocked(fileFor(id), null, current => {
        checked(current, id);
        if (current.status !== "COMPLETE" || options.fingerprint !== current.result_fingerprint) throw new Error("Review requires completed evidence and its current fingerprint");
        const history = current.review_history || (current.review ? [current.review] : []);
        current.review = { result: options.result, reason: options.reason.trim(), minutes, fingerprint: current.result_fingerprint, at: new Date(now()).toISOString() };
        current.review_history = [...history, current.review];
        current.review_history_fingerprint = hash(JSON.stringify(current.review_history));
        if (Buffer.byteLength(JSON.stringify(current)) > MAX_STATE_BYTES) throw new Error("Eval review history exceeds evidence size limit");
        return current;
      });
      return emit(summarize(record));
    }
    if (!["openai", "anthropic", "gemini"].includes(options.provider) || typeof options.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(options.model)) throw new Error("Run requires an explicit supported provider and model name");
    const cases = bank(), selectedIds = options.cases === undefined ? cases.map(c => c.id) : String(options.cases).split(",");
    if (!selectedIds.length || new Set(selectedIds).size !== selectedIds.length || selectedIds.some(id => !cases.some(c => c.id === id))) throw new Error("Unknown or duplicate eval case");
    const selected = cases.filter(c => selectedIds.includes(c.id));
    if (["max-attempts", "max-requests"].some(k => options[k] !== undefined && (typeof options[k] !== "string" || !/^[1-9]$/.test(options[k])))) throw new Error("Eval limits require an explicit integer value");
    const attempts = options["max-attempts"] === undefined ? 1 : Number(options["max-attempts"]);
    const budget = options["max-requests"] === undefined ? null : Number(options["max-requests"]);
    if (!Number.isInteger(attempts) || attempts < 1 || attempts > 3 || budget !== null && (!Number.isInteger(budget) || budget < 1 || budget > 9)) throw new Error("Eval limits: max-attempts 1..3; max-requests 1..9");
    if (options.live !== undefined && options.live !== true) throw new Error("Use --live without a value");
    const policy = { max_attempts: attempts, max_output_tokens: MAX_OUTPUT_TOKENS, max_requests: budget, system: SYSTEM,
      engine: hash(fs.readFileSync(path.join(__dirname, "model-eval-command.js"), "utf8").replace(/\r\n/g, "\n")),
      oracle: hash(fs.readFileSync(path.join(__dirname, "model-eval-oracle.js"), "utf8").replace(/\r\n/g, "\n")),
      transport: hash(fs.readFileSync(path.join(__dirname, "provider-request.js"), "utf8").replace(/\r\n/g, "\n")) };
    const cohort = hash(JSON.stringify({ cases: selected, policy }));
    if (!options.live) return emit({ mode: "dry-run", api_calls: 0, provider: options.provider, model: options.model, cases: selected.map(c => ({ id: c.id, input_fingerprint: hash(c.input) })), policy, cohort_fingerprint: cohort });
    if (env.HARNESS_AGENT_MODE !== "api" || budget === null) throw new Error("Live eval requires HARNESS_AGENT_MODE=api and explicit --max-requests");
    const record = { schema_version: "1.0", id: `eval-${crypto.randomUUID()}`, provider: options.provider, model: options.model,
      provenance: "provider-api", status: "RUNNING", started_at: new Date(now()).toISOString(), cohort_fingerprint: cohort, policy,
      cases: selected.map(c => ({ id: c.id, input: c.input, expected: c.expected, status: "NOT_RUN", attempts: [] })), review: null };
    save(record);
    let calls = 0, aborted = false;
    for (const item of record.cases) {
      for (let n = 0; n < attempts; n += 1) {
        if (calls >= budget || aborted) { aborted = true; break; }
        const prompt = item.input + (n ? `\nPrevious structural failures: ${item.attempts[n - 1].oracle.failures.join(", ")}. Return a corrected JSON object.` : "");
        const started = now(), attempt = { number: n + 1, prompt_fingerprint: hash(prompt), status: "STARTED", usage: null };
        item.attempts.push(attempt); calls += 1; save(record);
        let received = false;
        try {
          const result = await invokeAgent({ provider: options.provider, model: options.model, systemPrompt: SYSTEM, prompt, maxOutputTokens: MAX_OUTPUT_TOKENS, maxRequests: budget });
          received = true;
          attempt.latency_ms = Math.max(0, now() - started); attempt.usage = observedUsage(options.provider, result.response);
          attempt.response_model = typeof result.response_model === "string" ? result.response_model.slice(0, 120) : null;
          const text = typeof result.text === "string" ? result.text : "";
          attempt.output_fingerprint = hash(text);
          attempt.output = text.slice(0, 32768);
          attempt.oracle = text.length > 32768 ? { passed: false, failures: ["output-size-limit"] } : grade(item, text);
          attempt.status = "RECEIVED"; item.status = attempt.oracle.passed ? "PASS" : "FAIL";
        } catch {
          attempt.latency_ms = Math.max(0, now() - started); attempt.status = received ? "EVALUATION_ERROR" : "API_ERROR";
          attempt.error = received ? "Evaluation processing failed after the provider response; inspect local evidence. No automatic retry."
            : "Provider request failed; authentication, quota, timeout or transport must be diagnosed separately. No automatic API retry.";
          item.status = "ERROR"; aborted = true;
        }
        save(record);
        if (item.status === "PASS" || aborted) break;
      }
    }
    record.status = aborted || record.cases.some(c => ["NOT_RUN", "ERROR"].includes(c.status)) ? "INCOMPLETE" : "COMPLETE";
    record.finished_at = new Date(now()).toISOString(); save(record);
    const summary = emit(summarize(record));
    if (record.status !== "COMPLETE" || summary.passed !== summary.total) { const error = new Error(`Eval requires review: ${record.id}`); error.code = 1; throw error; }
    return summary;
  };
}
module.exports = { createModelEvalCommand, resultFingerprint, summarize };
