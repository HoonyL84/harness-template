"use strict";

const crypto = require("node:crypto");

function matchesPattern(filePath, pattern) {
  const normalizedFile = filePath.replace(/\\/g, "/").toLowerCase();
  const normalizedPattern = pattern.replace(/\\/g, "/").toLowerCase();
  let regex = "";

  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const char = normalizedPattern[index];
    if (char === "*" && normalizedPattern[index + 1] === "*") {
      index += 1;
      if (normalizedPattern[index + 1] === "/") {
        index += 1;
        regex += "(?:.*/)?";
      } else {
        regex += ".*";
      }
    } else if (char === "*") regex += "[^/]*";
    else if (char === "?") regex += "[^/]";
    else regex += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${regex}$`).test(normalizedFile);
}

function tokenizeCommand(commandLine, fail = (message) => { throw new Error(message); }) {
  const tokens = [];
  let current = "";
  let quote = "";

  for (let index = 0; index < commandLine.length; index += 1) {
    const char = commandLine[index];
    if (quote) {
      if (char === quote) quote = "";
      else current += char;
    } else if (char === "'" || char === "\"") quote = char;
    else if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else current += char;
  }

  if (quote) fail(`Verification command contains an unclosed quote: ${commandLine}`);
  if (current) tokens.push(current);
  if (tokens.length === 0) fail("Verification command must not be empty.");
  return tokens;
}

function inferQuickMappings({ packageScripts = {}, hasGradle = false }) {
  const mappings = {};
  const nodeCommands = [];
  if (packageScripts.test) nodeCommands.push("npm run test");
  if (packageScripts.lint) nodeCommands.push("npm run lint");
  if (nodeCommands.length > 0) {
    for (const pattern of [
      "src/**/*.js", "src/**/*.jsx", "src/**/*.ts", "src/**/*.tsx",
      "test/**/*.js", "tests/**/*.js", "__tests__/**/*.js", "tools/harness-cli/**/*.js"
    ]) {
      mappings[pattern] = nodeCommands;
    }
  }
  if (hasGradle) {
    for (const pattern of ["src/**/*.java", "src/**/*.kt", "src/**/*.kts"]) {
      mappings[pattern] = ["__HARNESS_GRADLE_TEST__"];
    }
  }
  return mappings;
}

function selectQuickCommands(dirtyFiles, configuredMappings, inferredMappings) {
  const mappings = Object.keys(configuredMappings).length > 0 ? configuredMappings : inferredMappings;
  const commands = new Set();
  for (const file of dirtyFiles) {
    for (const [pattern, patternCommands] of Object.entries(mappings)) {
      if (matchesPattern(file, pattern)) {
        for (const command of patternCommands) commands.add(command);
      }
    }
  }
  return Array.from(commands);
}

function createQuickCacheKey({ contentFingerprint, commands, nodeVersion, platform, arch }) {
  return crypto.createHash("sha256").update(JSON.stringify({
    contentFingerprint,
    commands: [...commands].sort(),
    nodeVersion,
    platform,
    arch
  })).digest("hex");
}

function createNodeVerificationSteps(packageScripts) {
  const steps = [];
  if (packageScripts.coverage) {
    steps.push({ script: "coverage", label: "Node coverage", substantive: true });
  } else if (packageScripts.test) {
    steps.push({ script: "test", label: "Node test", substantive: true });
  }
  if (packageScripts.lint) {
    steps.push({ script: "lint", label: "Node lint", substantive: false });
  }
  if (packageScripts.build) {
    steps.push({ script: "build", label: "Node build", substantive: true });
  }

  const selected = new Set(steps.map((step) => step.script));
  return steps.filter((step) => {
    const delegate = String(packageScripts[step.script] || "")
      .trim()
      .match(/^npm(?:\.cmd)?\s+run\s+([A-Za-z0-9:_-]+)$/);
    return !delegate || delegate[1] === step.script || !selected.has(delegate[1]);
  });
}
module.exports = {
  createNodeVerificationSteps,
  createQuickCacheKey,
  inferQuickMappings,
  matchesPattern,
  selectQuickCommands,
  tokenizeCommand
};
