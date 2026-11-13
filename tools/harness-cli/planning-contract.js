"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { hash } = require("./model-eval-oracle");
const { readOnboardingProfile } = require("./project-onboarding");
const { readRegistry, validateProjectId } = require("./project-registry");
const { assertRemoteReferences, normalizeContextRefs } = require("./context-references");
const { readConnection } = require("./jira-input");
const { normalizeRisk } = require("./model-router");
const { validateTicketGraph } = require("./request-plan");

const MAX_BYTES = 96 * 1024;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const secretPattern = /-----BEGIN [^-]*PRIVATE KEY-----|\b(?:sk-(?:ant-)?[A-Za-z0-9_-]{20,}|ATATT[A-Za-z0-9_=/-]{20,})|(?:api[_-]?key|api[_-]?token|password|authorization)["']?\s*[=:]\s*["']?[A-Za-z0-9_/-]{16,}/i;

function safeRelative(relative) {
  if (typeof relative !== "string" || relative.length > 500 || relative.split("/").some(p => !p || p.startsWith(".") || /[\\<>:"|?*]/.test(p) || [...p].some(c => c.charCodeAt(0) < 32) || /[. ]$/.test(p)
    || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p) || /^(?:node_modules|vendor|secrets?|credentials?)(?:\.|$)/i.test(p))) throw new Error("Unsafe planning path");
}

// Internal state permits .harness, but rejects links at each controlled component.
function stateFile(root, relative, area = "planning") {
  if (!["planning", "requests", "remote-context"].includes(area)) throw new Error("Invalid planning state area");
  safeRelative(relative);
  let current = fs.realpathSync(root);
  for (const p of [".harness", "local", area, ...relative.split("/")]) {
    current = path.join(current, p);
    try { if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Planning state symlink/junction rejected"); }
    catch (e) { if (e.code !== "ENOENT") throw e; }
  }
  return current;
}

/** Reject links in every relative component; this is not an OS sandbox. */
function safeFile(root, relative, mustExist = true) {
  safeRelative(relative);
  const base = fs.realpathSync(root);
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error("Planning project root symlink/junction rejected");
  let current = base;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    if (fs.existsSync(current) || (() => { try { fs.lstatSync(current); return true; } catch { return false; } })()) {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Planning symlink/junction rejected");
    }
  }
  if (mustExist && (!fs.existsSync(current) || !fs.statSync(current).isFile())) throw new Error("Required planning file missing");
  return current;
}

/** Bound JSON/text reads before parsing or sending to a model. */
function boundedText(file, limit = MAX_BYTES) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error("Planning input must be a bounded regular file");
  return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}
function readJson(file) { return JSON.parse(boundedText(file, 2 * 1024 * 1024)); }
function assertNoSecrets(value) {
  if (secretPattern.test(typeof value === "string" ? value : JSON.stringify(value))) throw new Error("Possible secret in planning data; sanitize before capture/transmission");
}
function seal(value) { return { ...value, fingerprint: hash(JSON.stringify(value)) }; }
function unseal(value) {
  const { fingerprint, ...body } = value || {};
  if (!fingerprint || hash(JSON.stringify(body)) !== fingerprint) throw new Error("Planning evidence fingerprint mismatch");
  return body;
}

function loadProjects(root, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 10 || new Set(ids).size !== ids.length) throw new Error("Select 1..10 distinct planning projects");
  const registry = readRegistry(path.join(root, ".harness/local/projects.json"));
  return Object.fromEntries(ids.map(id => {
    validateProjectId(id);
    const project = registry.projects[id];
    const profile = readOnboardingProfile(path.join(root, ".harness/local/profiles", id + ".json"));
    if (!project || profile?.status !== "APPROVED" || path.resolve(project.path) !== path.resolve(profile.project_path)) throw new Error("Approved matching project profile required: " + id);
    return [id, { project, profile }];
  }));
}

function captureSource(root, projects, ref) {
  if (!ref || !ID.test(ref.source_id) || !projects[ref.project_id]) throw new Error("Invalid planning source identity");
  let content, sha256, identity;
  if (ref.page_id !== undefined) {
    const [remoteRef] = normalizeContextRefs([{ page_id: ref.page_id, version: ref.version, max_age_minutes: ref.max_age_minutes }]);
    const cache = readJson(stateFile(root, ref.project_id + ".json", "remote-context"));
    const config = readConnection(root), settings = config?.confluence_projects?.[ref.project_id];
    if (cache.project_id !== ref.project_id || cache.site !== config?.site || cache.space_id !== settings?.space_id || cache.cloud_id !== (config?.cloud_id || null)
      || !settings?.context_page_ids?.includes(ref.page_id)) throw new Error("Remote planning context does not match connection");
    assertRemoteReferences([remoteRef], cache);
    content = cache.pages.find(p => p.id === ref.page_id).content;
    if (typeof content !== "string" || Buffer.byteLength(content) > MAX_BYTES) throw new Error("Invalid remote planning content");
    sha256 = hash(content); identity = remoteRef;
  } else {
    if (!/\.(?:md|txt|json|java|js|cjs|mjs|ts|tsx|jsx|py|go|rs|kt|sql)$/i.test(ref.path || "")) throw new Error("Select explicit text/code planning sources");
    if (/\.md$/i.test(ref.path)) normalizeContextRefs([{ path: ref.path }]);
    content = boundedText(safeFile(projects[ref.project_id].project.path, ref.path));
    sha256 = hash(content); identity = { path: ref.path };
  }
  const lines = content.split(/\r?\n/);
  if (content.includes("\0")) throw new Error("Planning sources must be text");
  const start = ref.start_line ?? 1, end = ref.end_line ?? lines.length;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > lines.length) throw new Error("Invalid planning source line range");
  const selected = lines.slice(start - 1, end).join("\n");
  assertNoSecrets(selected);
  return { source_id: ref.source_id, project_id: ref.project_id, ...identity, sha256, start_line: start, end_line: end, content: selected };
}

/** Snapshot only selected material; project instructions cannot grant authority. */
function captureInput(root, specification) {
  if (typeof specification.request !== "string" || !specification.request.trim() || !Array.isArray(specification.sources) || specification.sources.length > 10) throw new Error("Planning request and up to 10 explicit sources required");
  assertNoSecrets(specification.request);
  const projects = loadProjects(root, specification.projects);
  const sources = specification.sources.map(ref => captureSource(root, projects, ref));
  if (new Set(sources.map(s => s.source_id)).size !== sources.length) throw new Error("Duplicate planning source IDs");
  const missing = specification.missing_context ?? [];
  if (!Array.isArray(missing) || missing.some(s => typeof s !== "string" || !s.trim())) throw new Error("Invalid missing_context");
  const input = { schema_version: "1.0", request: specification.request, risk: normalizeRisk(specification.risk ?? "medium"),
    prompt_template: boundedText(path.join(root, "prompts/templates/planning-quality.md")),
    projects: Object.fromEntries(Object.entries(projects).map(([id, { profile }]) => [id, { profile_fingerprint: profile.content_fingerprint, verify_commands: profile.verify_commands }])),
    sources, missing_context: missing };
  if (Buffer.byteLength(JSON.stringify(input)) > MAX_BYTES) throw new Error("Planning context exceeds 96KB; narrow sources, no silent truncation");
  assertNoSecrets(input);
  return seal(input);
}

function assertFreshInput(root, input) {
  unseal(input);
  const current = captureInput(root, { request: input.request, risk: input.risk, projects: Object.keys(input.projects), sources: input.sources, missing_context: input.missing_context });
  if (current.fingerprint !== input.fingerprint) throw new Error("Planning sources/profile/prompt changed; capture a new input and review again");
}

/** Contract and citation checks only; semantic truth requires human review. */
function validateOutput(input, output) {
  unseal(input);
  if (!output || typeof output !== "object" || !output.plan || !Array.isArray(output.plan.tickets) || !output.plan.tickets.length || output.plan.tickets.length > 20) throw new Error("Detailed planning output required");
  if (Object.keys(output.plan).some(k => !["goal", "assumptions", "exclusions", "tickets"].includes(k))) throw new Error("Unexpected planning payload fields");
  for (const key of ["facts", "proposals", "questions", "paths", "relations"]) if (!Array.isArray(output[key]) || output[key].length > 200) throw new Error("Planning array required: " + key);
  if (Buffer.byteLength(JSON.stringify(output)) > MAX_BYTES) throw new Error("Planning output exceeds 96KB");
  assertNoSecrets(output);
  const tickets = output.plan.tickets, ids = new Set(tickets.map(t => t.ticket_id));
  const text = v => typeof v === "string" && v.trim().length > 0;
  const strings = a => Array.isArray(a) && a.length && a.every(text);
  if (!text(output.plan.goal) || !["assumptions", "exclusions"].every(k => Array.isArray(output.plan[k]) && output.plan[k].every(text))) throw new Error("Invalid planning goal/assumptions/exclusions");
  if (ids.size !== tickets.length) throw new Error("Duplicate planning ticket IDs");
  for (const t of tickets) {
    if (Object.keys(t).some(k => !["ticket_id", "project_id", "title", "ticket_kind", "deliverables", "goal", "priority", "risk", "risk_reason", "labels", "scope", "exclusions", "acceptance_criteria", "implementation_steps", "test_plan", "verification", "depends_on", "retry_policy", "context_summary", "context_refs", "source"].includes(k))) throw new Error("Unexpected planning ticket field");
    if (t.title !== undefined && !text(t.title)) throw new Error("Invalid planning ticket title");
    if (!ID.test(t.ticket_id) || !input.projects[t.project_id] || !text(t.goal) || !["low", "medium", "high"].includes(t.risk) || !text(t.risk_reason)
      || !["development", "planning", "design"].includes(t.ticket_kind) || !["P0", "P1", "P2", "P3"].includes(t.priority) || !strings(t.labels) || t.labels.length > 3
      || !["scope", "acceptance_criteria", "implementation_steps"].every(k => strings(t[k])) || !Array.isArray(t.exclusions) || !t.exclusions.every(text)
      || !t.test_plan || !["unit", "integration", "regression", "manual"].every(k => Array.isArray(t.test_plan[k]) && t.test_plan[k].every(text))
      || !Object.values(t.test_plan).some(a => Array.isArray(a) && a.length) || !Array.isArray(t.depends_on)) throw new Error("Incomplete planning ticket contract");
    if (!strings(t.verification) || t.verification.some(cmd => !input.projects[t.project_id].verify_commands.includes(cmd))) throw new Error("Unapproved planning verification command");
    if (!output.proposals.some(p => p.ticket_id === t.ticket_id)) throw new Error("Every ticket requires an explicit implementation proposal");
  }
  validateTicketGraph(tickets);
  for (const f of output.facts) {
    const s = input.sources.find(s => s.source_id === f.source_id);
    const t = tickets.find(t => t.ticket_id === f.ticket_id);
    if (!s || !t || s.project_id !== t.project_id || !text(f.statement) || !Number.isInteger(f.start_line) || !Number.isInteger(f.end_line)
      || f.start_line < s.start_line || f.end_line > s.end_line || f.end_line < f.start_line
      || !text(f.quote) || f.quote !== s.content.split("\n").slice(f.start_line - s.start_line, f.end_line - s.start_line + 1).join("\n")) throw new Error("Invalid planning citation");
  }
  for (const p of output.proposals) if (!ids.has(p.ticket_id) || !text(p.statement) || !text(p.request_quote) || !input.request.includes(p.request_quote)) throw new Error("Proposal must cite the original request");
  const questionIds = new Set();
  for (const q of output.questions) {
    if (!ID.test(q.id) || questionIds.has(q.id) || !text(q.question) || typeof q.blocking !== "boolean" || !Array.isArray(q.ticket_ids) || q.ticket_ids.some(id => !ids.has(id))) throw new Error("Invalid planning question");
    questionIds.add(q.id);
  }
  for (const p of output.paths) {
    const t = tickets.find(t => t.ticket_id === p.ticket_id);
    if (!t || !["existing", "new"].includes(p.kind)) throw new Error("Invalid planning path claim");
    // Existing claims must name a captured source. New paths are proposals, not verified facts.
    if (p.kind === "existing" && !input.sources.some(s => s.project_id === t.project_id && s.path === p.path)) throw new Error("Existing planning path not in snapshot");
    safeRelative(p.path);
  }
  for (const r of output.relations) if (!ids.has(r.from) || !ids.has(r.to) || r.from === r.to || !["git_dependency", "document", "related"].includes(r.kind)
    || r.kind === "git_dependency" && !tickets.find(t => t.ticket_id === r.to).depends_on.includes(r.from)) throw new Error("Invalid planning relation");
  for (const t of tickets) for (const dependency of t.depends_on) {
    if (!output.relations.some(r => r.kind === "git_dependency" && r.from === dependency && r.to === t.ticket_id)) throw new Error("Every Git dependency must be disclosed in relations");
  }
  const ready = !output.questions.some(q => q.blocking) && input.missing_context.length === 0;
  return { ready, limitation: "Structure, references and boundaries only; not semantic correctness or completeness." };
}

function planPayload(plan) { return { goal: plan.goal, assumptions: plan.assumptions, exclusions: plan.exclusions, tickets: plan.tickets }; }

module.exports = { MAX_BYTES, assertFreshInput, assertNoSecrets, boundedText, captureInput, hash, loadProjects, planPayload, readJson, safeFile, seal, stateFile, unseal, validateOutput };
