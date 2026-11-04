"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { isDeepStrictEqual } = require("node:util");
const contract = require("./planning-contract");
const { stateFile } = contract;
const { createRequestPlan, planFingerprint, validateRequestPlan } = require("./request-plan");
const { normalizeJiraSource } = require("./jira-input");
const { writeJsonAtomic, updateJsonLocked } = require("./control-plane-state");
const { selectModelRoute } = require("./model-router");
const { observedUsage } = require("./model-eval-oracle");

const artifactId = id => typeof id === "string" && /^planning-[a-f0-9-]{36}$/.test(id);
const DRAFT_CONFLICT = "Planning draft changed concurrently; inspect the current plan before retrying";

/** Validate immutable evidence and current sources at managed approval/execution boundaries. */
function assertPlanningEvidence(root, plan, { fresh = true } = {}) {
  const ref = plan.planning_evidence;
  if (!ref) return;
  if (!artifactId(ref.id) || !/^[a-f0-9]{64}$/.test(ref.fingerprint)) throw new Error("Invalid planning evidence reference");
  const evidence = contract.readJson(stateFile(root, ref.id + ".json"));
  contract.unseal(evidence);
  if (evidence.fingerprint !== ref.fingerprint || evidence.request_id !== plan.request_id || evidence.ready !== ref.ready
    || evidence.plan_hash !== contract.hash(JSON.stringify(contract.planPayload(plan)))) throw new Error("Plan changed after quality validation; submit a revised draft");
  contract.unseal(evidence.input);
  const result = contract.validateOutput(evidence.input, evidence.output);
  if (result.ready !== ref.ready) throw new Error("Planning readiness changed");
  if (fresh) contract.assertFreshInput(root, evidence.input);
  return evidence;
}

/** Attach acknowledged Jira identity without silently changing the approved work proposal. */
function bindLinkedPlanningEvidence(root, previous, linked) {
  if (!previous.planning_evidence) return linked;
  const evidence = assertPlanningEvidence(root, previous);
  const output = JSON.parse(JSON.stringify(evidence.output));
  for (const t of output.plan.tickets) {
    const next = linked.tickets.find(item => item.ticket_id === t.ticket_id);
    if (next.source) t.source = next.source;
  }
  contract.validateOutput(evidence.input, output);
  const projects = contract.loadProjects(root, Object.keys(evidence.input.projects));
  const normalized = createRequestPlan({ ...output.plan, requestId: linked.request_id,
    profiles: Object.fromEntries(Object.entries(projects).map(([id, p]) => [id, p.profile])) });
  const planHash = contract.hash(JSON.stringify(contract.planPayload(linked)));
  if (!isDeepStrictEqual(contract.planPayload(linked), contract.planPayload(normalized))) throw new Error("Jira link changed planning content beyond source identity");
  const { fingerprint: _old, ...body } = evidence;
  const revised = contract.seal({ ...body, id: `planning-${crypto.randomUUID()}`, output,
    previous_evidence: previous.planning_evidence, plan_hash: planHash, event: "jira-link", recorded_at: new Date().toISOString() });
  writeJsonAtomic(stateFile(root, revised.id + ".json"), revised);
  linked.planning_evidence = { id: revised.id, fingerprint: revised.fingerprint, ready: revised.ready };
  linked.content_fingerprint = planFingerprint(linked);
  return linked;
}

/** Keep host and API output on one validation/import path; never execute generated text. */
function createPlanningCommand({ root, log, invokeAgent, env = process.env, now = () => Date.now() }) {
  const inputFile = id => stateFile(root, `input-${id}.json`);
  const requestFile = id => stateFile(root, id + ".json", "requests");
  const emit = value => { log(JSON.stringify(value, null, 2)); return value; };
  function inputFor(id) {
    const input = contract.readJson(inputFile(id));
    contract.unseal(input);
    return input;
  }
  function readRequest(id) {
    if (!fs.existsSync(requestFile(id))) return null;
    const plan = contract.readJson(requestFile(id));
    validateRequestPlan(plan);
    assertPlanningEvidence(root, plan);
    return plan;
  }
  function saveDraft(id, output, provenance, details = {}, previous = readRequest(id)) {
    const input = inputFor(id);
    contract.assertFreshInput(root, input);
    const check = contract.validateOutput(input, output);
    if (previous && previous.status !== "DRAFT") throw new Error("Only a DRAFT quality plan can be revised");
    output = JSON.parse(JSON.stringify(output));
    for (const ticket of output.plan.tickets) {
      const prior = previous?.tickets.find(t => t.ticket_id === ticket.ticket_id);
      if (!prior?.source) continue;
      if (ticket.project_id !== prior.project_id || (ticket.source && !isDeepStrictEqual(normalizeJiraSource(ticket.source), prior.source))) {
        throw new Error(`Jira source cannot change during planning revision: ${ticket.ticket_id}`);
      }
      ticket.source = { ...prior.source };
    }
    const projects = contract.loadProjects(root, Object.keys(input.projects));
    const plan = createRequestPlan({ ...output.plan, requestId: id, profiles: Object.fromEntries(Object.entries(projects).map(([k, v]) => [k, v.profile])) });
    const artifact = contract.seal({ schema_version: "1.0", id: `planning-${crypto.randomUUID()}`, request_id: id,
      input, output, provenance, generated_at: new Date(now()).toISOString(), prompt_fingerprint: contract.hash(input.prompt_template),
      ready: check.ready, previous_evidence: previous?.planning_evidence || null, plan_hash: contract.hash(JSON.stringify(contract.planPayload(plan))), ...details });
    // Evidence first: interruption can leave an orphan, never an approved plan without evidence.
    writeJsonAtomic(stateFile(root, artifact.id + ".json"), artifact);
    plan.planning_evidence = { id: artifact.id, fingerprint: artifact.fingerprint, ready: artifact.ready };
    plan.content_fingerprint = planFingerprint(plan);
    updateJsonLocked(requestFile(id), null, current => {
      if (!isDeepStrictEqual(current, previous)) throw Object.assign(new Error(DRAFT_CONFLICT), { code: "PLANNING_DRAFT_CHANGED" });
      if (current && current.status !== "DRAFT") throw new Error("Only a DRAFT quality plan can be revised");
      return plan;
    });
    return emit({ request_id: id, status: "DRAFT", ready: check.ready, fingerprint: plan.content_fingerprint,
      evidence: plan.planning_evidence, summary: plan.tickets.map(t => ({ id: t.ticket_id, project: t.project_id, goal: t.goal, priority: t.priority, risk: t.risk, depends_on: t.depends_on })),
      questions: output.questions, relations: output.relations, limitation: check.limitation });
  }
  return async function planning(action, id, options) {
    const allowed = { capture: ["input-file"], draft: ["output-file"], planning: [], "planning-review": ["review-file"], generate: ["provider", "model-tier", "live", "approve-send", "input-fingerprint", "max-requests"] };
    if (!allowed[action] || Object.keys(options).some(k => !allowed[action].includes(k))) throw new Error("Invalid planning action/options");
    if (action === "capture") {
      if (typeof options["input-file"] !== "string") throw new Error("capture requires --input-file");
      if (fs.existsSync(requestFile(id))) throw new Error("Request already exists; use a new capture ID");
      const spec = JSON.parse(contract.boundedText(path.resolve(options["input-file"])));
      const input = contract.captureInput(root, spec);
      updateJsonLocked(inputFile(id), null, existing => { if (existing) throw new Error("Planning input already exists; use a new capture ID"); return input; });
      return emit({ request_id: id, input_fingerprint: input.fingerprint, input, prompt_fingerprint: contract.hash(input.prompt_template), api_calls: 0,
        limitation: "Selected project sources are untrusted data. No hidden host prompt/model usage is measured." });
    }
    if (action === "planning") {
      const file = requestFile(id);
      const plan = fs.existsSync(file) ? contract.readJson(file) : null;
      const reviews = fs.existsSync(path.dirname(inputFile(id))) ? fs.readdirSync(path.dirname(inputFile(id))).filter(n => /^review-[a-f0-9-]{36}\.json$/.test(n))
        .map(n => contract.readJson(stateFile(root, n))).filter(r => r.request_id === id) : [];
      reviews.forEach(contract.unseal);
      return emit({ input: inputFor(id), plan, evidence: plan?.planning_evidence ? assertPlanningEvidence(root, plan, { fresh: false }) : null, reviews });
    }
    if (action === "planning-review") {
      if (typeof options["review-file"] !== "string") throw new Error("planning-review requires --review-file");
      const plan = contract.readJson(requestFile(id));
      const evidence = assertPlanningEvidence(root, plan);
      if (!evidence) throw new Error("Quality planning evidence required");
      const review = JSON.parse(contract.boundedText(path.resolve(options["review-file"])));
      if (!review || Object.keys(review).some(k => !["fingerprint", "result", "reason", "minutes", "tickets"].includes(k))
        || review.fingerprint !== evidence.fingerprint || !["accepted", "changes-requested"].includes(review.result) || typeof review.reason !== "string" || !review.reason.trim()
        || !Number.isFinite(review.minutes) || review.minutes < 0 || review.minutes > 10000 || !Array.isArray(review.tickets)
        || review.tickets.length !== plan.tickets.length || new Set(review.tickets.map(t => t.ticket_id)).size !== review.tickets.length) throw new Error("Invalid or stale planning human review");
      for (const t of review.tickets) {
        const fields = ["required_total", "omissions", "claims_total", "unsupported_claims", "boundary_total", "boundary_correct", "unnecessary_questions", "content_edits"];
        if (!plan.tickets.some(p => p.ticket_id === t.ticket_id) || fields.some(k => !Number.isSafeInteger(t[k]) || t[k] < 0)
          || t.omissions > t.required_total || t.unsupported_claims > t.claims_total || t.boundary_correct > t.boundary_total) throw new Error("Invalid planning rubric counts");
      }
      contract.assertNoSecrets(review);
      const total = key => review.tickets.reduce((n, t) => n + t[key], 0);
      const ratio = (n, d) => total(d) ? total(n) / total(d) : null;
      const record = contract.seal({ id: `review-${crypto.randomUUID()}`, request_id: id, evidence_fingerprint: review.fingerprint,
        result: review.result, reason: review.reason, minutes: review.minutes, tickets: review.tickets, recorded_at: new Date(now()).toISOString(),
        metrics: { omission_rate: ratio("omissions", "required_total"), unsupported_claim_rate: ratio("unsupported_claims", "claims_total"), boundary_compliance: ratio("boundary_correct", "boundary_total"), content_edits: total("content_edits") },
        limitation: "Human-provided rubric counts, not an automatic semantic oracle or release approval." });
      writeJsonAtomic(stateFile(root, record.id + ".json"), record);
      return emit(record);
    }
    if (action === "draft") {
      if (typeof options["output-file"] !== "string") throw new Error("draft requires --output-file");
      return saveDraft(id, JSON.parse(contract.boundedText(path.resolve(options["output-file"]))), "interactive-host", { model: null, usage: null });
    }
    const input = inputFor(id);
    contract.assertFreshInput(root, input);
    // Freeze the draft before awaiting a provider; a later human edit must win.
    const previous = readRequest(id);
    if (previous && previous.status !== "DRAFT") throw new Error("Only a DRAFT plan can be generated");
    if (!["openai", "anthropic", "gemini"].includes(options.provider)) throw new Error("generate requires an explicit provider");
    // Capture-time risk is trusted routing input, not a model-generated instruction.
    const route = selectModelRoute(options.provider, { type: "docs", role: "planner", risk: input.risk, tierOverride: options["model-tier"] }, env);
    const systemPrompt = input.prompt_template;
    if (options.live === undefined) return emit({ mode: "dry-run", api_calls: 0, route, input_fingerprint: input.fingerprint, input, prompt_fingerprint: contract.hash(systemPrompt), max_requests: 1 });
    if (options.live !== true || options["approve-send"] !== true || env.HARNESS_AGENT_MODE !== "api" || options["max-requests"] !== "1"
      || options["input-fingerprint"] !== input.fingerprint) throw new Error("Live planning requires API mode, --live --approve-send --max-requests 1 and current --input-fingerprint");
    if (typeof invokeAgent !== "function") throw new Error("Planning provider transport unavailable");
    const attempt = { id: `planning-${crypto.randomUUID()}`, status: "STARTED", input_fingerprint: input.fingerprint,
      request_fingerprint: previous?.content_fingerprint || null, route, started_at: new Date(now()).toISOString() };
    const file = stateFile(root, attempt.id + ".json");
    writeJsonAtomic(file, contract.seal(attempt));
    try {
      const started = now();
      // Keep the exact system prompt in the snapshot, but do not send it twice.
      const { prompt_template: _template, ...providerInput } = input;
      const result = await invokeAgent({ provider: route.provider, model: route.model, systemPrompt, prompt: JSON.stringify(providerInput), maxOutputTokens: 4096, maxRequests: 1 });
      attempt.latency_ms = Math.max(0, now() - started);
      attempt.usage = observedUsage(route.provider, result.response);
      attempt.response_model = result.response_model || null;
      if (typeof result.text !== "string" || Buffer.byteLength(result.text) > contract.MAX_BYTES) throw new Error("Invalid planning response size");
      contract.assertNoSecrets(result.text);
      attempt.output = result.text;
      attempt.status = "RECEIVED";
      writeJsonAtomic(file, contract.seal(attempt));
      return saveDraft(id, JSON.parse(result.text), "provider-api", { model: attempt.response_model || route.model, requested_route: route, usage: attempt.usage, latency_ms: attempt.latency_ms }, previous);
    } catch (error) {
      attempt.status = "FAILED";
      attempt.error = error?.code === "PLANNING_DRAFT_CHANGED" ? DRAFT_CONFLICT
        : "Provider or output validation failed. Inspect local attempt; no automatic retry or execution.";
      writeJsonAtomic(file, contract.seal(attempt));
      throw new Error(attempt.error);
    }
  };
}

module.exports = { assertPlanningEvidence, bindLinkedPlanningEvidence, createPlanningCommand };
