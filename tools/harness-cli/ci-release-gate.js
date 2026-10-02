"use strict";

const CORE_JOBS = ["detect-project", "harness-governance", "harness-cross-platform"];
const PROFILE_JOBS = Object.freeze({
  "node-ci": "has_node", "gradle-ci": "has_gradle", "maven-ci": "has_maven",
  "python-ci": "has_python", "go-ci": "has_go", "rust-ci": "has_rust", "dotnet-ci": "has_dotnet"
});

/** Fail closed on missing, failed, cancelled or unexpectedly skipped required CI jobs. */
function assertReleaseGate(needs) {
  if (!needs || typeof needs !== "object" || Array.isArray(needs)) throw new Error("CI dependency results are missing");
  for (const job of CORE_JOBS) {
    if (needs[job]?.result !== "success") throw new Error(`Required CI job did not succeed: ${job}`);
  }
  const outputs = needs["detect-project"].outputs;
  for (const [job, flag] of Object.entries(PROFILE_JOBS)) {
    if (!["true", "false"].includes(outputs?.[flag])) throw new Error(`Project detection output is missing or invalid: ${flag}`);
    const expected = outputs[flag] === "true" ? "success" : "skipped";
    if (needs[job]?.result !== expected) throw new Error(`CI job ${job} must be ${expected}, received ${needs[job]?.result || "missing"}`);
  }
  return true;
}

if (require.main === module) {
  try {
    assertReleaseGate(JSON.parse(process.env.CI_NEEDS_JSON || "null"));
    process.stdout.write("Release Gate passed: every applicable verification job succeeded.\n");
  } catch (error) {
    process.stderr.write(`Release Gate blocked: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { assertReleaseGate };
