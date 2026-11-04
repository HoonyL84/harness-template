"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createModelEvalCommand } = require("./model-eval-command");
const { createRequestPlan } = require("./request-plan");
const { hash, unseal, validateOutput, assertNoSecrets } = require("./planning-contract");

/** Use fixed source snapshots, never send the answer key to the model. */
function validateCase(c) {
  try {
    if (!/^[a-z0-9-]+$/.test(c.id) || !["development", "holdout"].includes(c.split) || typeof c.input !== "string") return false;
    const input = JSON.parse(c.input);
    unseal(input); assertNoSecrets(input);
    return c.expected && typeof c.expected.ready === "boolean" && Array.isArray(c.rubric?.required) && Array.isArray(c.rubric?.forbidden);
  } catch { return false; }
}

function grade(c, text) {
  try {
    const input = JSON.parse(c.input), output = JSON.parse(text);
    const check = validateOutput(input, output);
    createRequestPlan({ requestId: "evaluation", ...output.plan,
      profiles: Object.fromEntries(Object.entries(input.projects).map(([id, p]) => [id, { status: "APPROVED", content_fingerprint: p.profile_fingerprint, verify_commands: p.verify_commands }])) });
    return { passed: check.ready === c.expected.ready, failures: check.ready === c.expected.ready ? [] : ["expected-readiness"],
      limitation: "Semantic omission, unsupported claims and question quality require the human rubric." };
  } catch { return { passed: false, failures: ["planning-contract-or-citation-invalid"] }; }
}

function createPlanningEvalCommand(dependencies) {
  const system = fs.readFileSync(path.join(dependencies.root, "prompts/templates/planning-quality.md"), "utf8");
  const fingerprint = hash([system, fs.readFileSync(path.join(__dirname, "planning-eval.js"), "utf8"), fs.readFileSync(path.join(__dirname, "planning-contract.js"), "utf8"), fs.readFileSync(path.join(__dirname, "request-plan.js"), "utf8")].join("\n").replace(/\r\n/g, "\n"));
  return createModelEvalCommand({ ...dependencies, caseBank: { file: "evals/regression/planning-quality-cases.json", kind: "planning-quality-v1", system, fingerprint, validate: validateCase, grade } });
}

module.exports = { createPlanningEvalCommand, grade, validateCase };
