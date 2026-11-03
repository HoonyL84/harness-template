"use strict";

const fs = require("node:fs");
const path = require("node:path");
const MAX_BYTES = 256 * 1024;
const DEFAULT_SKILL = "code-review";
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const DEFAULT_ROOT = path.resolve(__dirname, "../..");

function assertNoSymlink(targetPath, label) {
  if (!fs.existsSync(targetPath)) {
    throw new Error(`${label} not found: ${path.basename(targetPath)}`);
  }
  const stat = fs.lstatSync(targetPath);
  if (stat.isSymbolicLink()) {
    throw new Error(`Unsafe symlink or junction rejected for ${label}`);
  }
  return stat;
}

/**
 * Resolve and validate the case file path for a named skill under `skills/<skillName>/examples.jsonl`.
 * @param {string} [skillName]
 * @param {string} [rootDir]
 * @returns {string}
 */
function resolveSkillCaseFile(skillName = DEFAULT_SKILL, rootDir = DEFAULT_ROOT) {
  const normalized = String(skillName || DEFAULT_SKILL).trim();
  if (!SKILL_NAME_RE.test(normalized)) {
    throw new Error(`Invalid skill name: ${normalized}`);
  }
  const skillsRoot = path.join(rootDir, "skills");
  const skillDir = path.join(skillsRoot, normalized);
  const caseFile = path.join(skillDir, "examples.jsonl");
  assertNoSymlink(skillsRoot, "skills root");
  assertNoSymlink(skillDir, `skill directory (${normalized})`);
  assertNoSymlink(caseFile, `skill cases (${normalized})`);
  return caseFile;
}

/**
 * List available skills that define both `SKILL.md` and `examples.jsonl` without symlinks.
 * @param {string} [rootDir]
 * @returns {string[]}
 */
function listSkills(rootDir = DEFAULT_ROOT) {
  const skillsRoot = path.join(rootDir, "skills");
  if (!fs.existsSync(skillsRoot)) return [];
  assertNoSymlink(skillsRoot, "skills root");
  return fs.readdirSync(skillsRoot)
    .filter(name => SKILL_NAME_RE.test(name))
    .filter(name => {
      const dir = path.join(skillsRoot, name);
      const skillMd = path.join(dir, "SKILL.md");
      const casesFile = path.join(dir, "examples.jsonl");
      try {
        return fs.lstatSync(dir).isDirectory()
          && !fs.lstatSync(dir).isSymbolicLink()
          && fs.existsSync(skillMd) && !fs.lstatSync(skillMd).isSymbolicLink()
          && fs.existsSync(casesFile) && !fs.lstatSync(casesFile).isSymbolicLink();
      } catch {
        return false;
      }
    })
    .sort();
}

function readBounded(file) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error("Evaluation input must be a file <=256KB");
  return fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
}

/** Check fixture contracts only; explanation correctness still needs human review. */
function gradeReviewCases(cases, responses) {
  if (!Array.isArray(responses)) throw new Error("Responses must be an array");
  const ids = new Set(cases.map(c => c.id));
  if (responses.length > cases.length || new Set(responses.map(r => r?.id)).size !== responses.length
      || responses.some(r => !ids.has(r?.id))) throw new Error("Duplicate or unknown response IDs");
  return cases.map(c => {
    const r = responses.find(row => row.id === c.id);
    const errors = [];
    if (!r) return { id: c.id, result: "FAIL", errors: ["Missing response"] };
    if (r.selected_skill !== c.expected.selected_skill || r.status !== c.expected.status) errors.push("Wrong skill selection or status");
    const validFindings = Array.isArray(r.findings) && r.findings.every(f => f && ["P0", "P1", "P2", "P3"].includes(f.severity)
      && typeof f.file === "string" && f.file && Number.isInteger(f.line) && f.line > 0
      && typeof f.explanation === "string" && f.explanation.trim() && typeof f.suggestion === "string" && f.suggestion.trim());
    if (!validFindings) errors.push("Findings require severity, file, line, explanation and suggestion");
    for (const field of ["residual_risks", "tests_run", "limitations"]) {
      if (!Array.isArray(r[field]) || r[field].some(v => typeof v !== "string" || !v.trim())) errors.push("Invalid " + field);
    }
    if (!r.tests_run?.length && !r.limitations?.length) errors.push("Unexecuted tests require a limitation");
    if (validFindings) {
      for (const f of r.findings) {
        if (!c.locations.some(l => l.file === f.file && f.line >= l.start && f.line <= l.end)) errors.push("Finding outside supplied diff");
      }
      for (const expected of c.expected.findings) {
        if (!r.findings.some(f => f.file === expected.file && f.line === expected.line && expected.severities.includes(f.severity))) {
          errors.push("Missed known fixture defect");
        }
      }
      if (c.expected.no_findings && r.findings.length) errors.push("Unexpected finding");
    }
    if (r.status === "reviewed" && !r.findings?.length && !r.residual_risks?.length) errors.push("No-finding review requires residual risks");
    return { id: c.id, result: errors.length ? "FAIL" : "PASS", errors };
  });
}

/**
 * Load and validate JSONL evaluation fixtures for a skill.
 * @param {string} [skillName]
 * @param {string} [rootDir]
 * @returns {Array<object>}
 */
function loadCases(skillName = DEFAULT_SKILL, rootDir = DEFAULT_ROOT) {
  const caseFile = resolveSkillCaseFile(skillName, rootDir);
  const cases = readBounded(caseFile).trim().split(/\r?\n/).map(line => JSON.parse(line));
  if (!cases.length || cases.some(c => !c.id || typeof c.input !== "string" || typeof c.diff !== "string"
      || !Array.isArray(c.locations) || !Array.isArray(c.expected?.findings))
      || new Set(cases.map(c => c.id)).size !== cases.length) throw new Error("Invalid skill case bank");
  return cases;
}

function parseSkillArgs(args) {
  let skill = DEFAULT_SKILL;
  const rest = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--skill") {
      if (!args[i + 1]) throw new Error("Usage: skill-eval.js [--skill <name>] (--cases | --responses <json-file> | --list-skills)");
      skill = args[i + 1];
      i += 1;
    } else {
      rest.push(args[i]);
    }
  }
  return { skill, rest };
}

/** Run offline evaluation against separately captured responses, never model calls. */
function main(args = process.argv.slice(2), rootDir = DEFAULT_ROOT) {
  const { skill, rest } = parseSkillArgs(args);
  if (rest.length === 1 && rest[0] === "--list-skills") {
    process.stdout.write(JSON.stringify({ skills: listSkills(rootDir) }, null, 2) + "\n");
    return 0;
  }
  const cases = loadCases(skill, rootDir);
  if (rest.length === 1 && rest[0] === "--cases") {
    process.stdout.write(JSON.stringify(cases.map(({ expected: _expected, ...input }) => input), null, 2) + "\n");
    return 0;
  }
  if (rest.length !== 2 || rest[0] !== "--responses") {
    throw new Error("Usage: skill-eval.js [--skill <name>] (--cases | --responses <json-file> | --list-skills)");
  }
  const results = gradeReviewCases(cases, JSON.parse(readBounded(rest[1])));
  process.stdout.write(JSON.stringify({ skill, results, limitation: "Fixture location/severity and response contracts only; human semantic review required." }, null, 2) + "\n");
  return results.every(r => r.result === "PASS") ? 0 : 1;
}

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) { process.stderr.write(error.message + "\n"); process.exitCode = 1; }
}
module.exports = { DEFAULT_SKILL, gradeReviewCases, listSkills, loadCases, main, resolveSkillCaseFile };
