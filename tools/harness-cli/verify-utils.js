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

function detectVerificationProfiles({ rootFiles = [], packageScripts = {} }) {
  const files = new Set(rootFiles.map((file) => String(file).replace(/\\/g, "/").toLowerCase()));
  const profiles = [];
  if (files.has("build.gradle") || files.has("build.gradle.kts")) profiles.push("gradle");
  if (files.has("pom.xml")) profiles.push("maven");
  if (["pyproject.toml", "pytest.ini", "setup.py", "setup.cfg", "requirements.txt", "tox.ini"]
    .some((file) => files.has(file))) {
    profiles.push("python");
  }
  if (files.has("go.mod")) profiles.push("go");
  if (files.has("cargo.toml")) profiles.push("rust");
  if (Array.from(files).some((file) =>
    [".sln", ".csproj", ".fsproj", ".vbproj"].some((extension) => file.endsWith(extension)))) {
    profiles.push("dotnet");
  }
  if (files.has("package.json") && createNodeVerificationSteps(packageScripts).length > 0) {
    profiles.push("node");
  }
  return profiles;
}

function inferQuickMappings({ packageScripts = {}, hasGradle = false, profiles = [] }) {
  const mappings = {};
  const addCommands = (pattern, commands) => {
    mappings[pattern] = Array.from(new Set([...(mappings[pattern] || []), ...commands]));
  };
  const detected = new Set(profiles);
  if (hasGradle) detected.add("gradle");
  const nodeCommands = [];
  if (packageScripts.test) nodeCommands.push("npm run test");
  if (packageScripts.lint) nodeCommands.push("npm run lint");
  if (nodeCommands.length > 0) {
    for (const pattern of [
      "src/**/*.js", "src/**/*.jsx", "src/**/*.ts", "src/**/*.tsx",
      "test/**/*.js", "tests/**/*.js", "__tests__/**/*.js", "tools/harness-cli/**/*.js"
    ]) {
      addCommands(pattern, nodeCommands);
    }
  }
  if (detected.has("gradle")) {
    for (const pattern of [
      "src/**/*.java", "src/**/*.kt", "src/**/*.kts",
      "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"
    ]) {
      addCommands(pattern, ["__HARNESS_GRADLE_TEST__"]);
    }
  }
  if (detected.has("maven")) {
    for (const pattern of ["src/**/*.java", "src/**/*.kt", "pom.xml"]) {
      addCommands(pattern, ["__HARNESS_MAVEN_TEST__"]);
    }
  }
  if (detected.has("python")) {
    for (const pattern of [
      "**/*.py", "pyproject.toml", "pytest.ini", "setup.py", "setup.cfg", "requirements.txt", "tox.ini"
    ]) {
      addCommands(pattern, ["__HARNESS_PYTHON_TEST__"]);
    }
  }
  if (detected.has("go")) {
    for (const pattern of ["**/*.go", "go.mod", "go.sum"]) addCommands(pattern, ["__HARNESS_GO_TEST__"]);
  }
  if (detected.has("rust")) {
    for (const pattern of ["**/*.rs", "cargo.toml", "cargo.lock"]) addCommands(pattern, ["__HARNESS_RUST_TEST__"]);
  }
  if (detected.has("dotnet")) {
    for (const pattern of ["**/*.cs", "**/*.fs", "**/*.vb", "*.sln", "*.csproj", "*.fsproj", "*.vbproj"]) {
      addCommands(pattern, ["__HARNESS_DOTNET_TEST__"]);
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

function createProfileVerificationSteps({
  profiles,
  packageScripts = {},
  platform = process.platform,
  hasJacoco = false,
  hasMavenWrapper = true
}) {
  const steps = [];
  const gradle = platform === "win32" ? "gradlew.bat" : "./gradlew";
  const maven = hasMavenWrapper
    ? (platform === "win32" ? "mvnw.cmd" : "./mvnw")
    : (platform === "win32" ? "mvn.cmd" : "mvn");
  const python = platform === "win32" ? "python" : "python3";

  for (const profile of profiles) {
    if (profile === "gradle") {
      steps.push({ label: "Gradle test", command: gradle, args: ["test"], substantive: true });
      if (hasJacoco) {
        steps.push({
          label: "Gradle coverage",
          command: gradle,
          args: ["jacocoTestCoverageVerification"],
          substantive: false
        });
      }
      steps.push({ label: "Gradle build", command: gradle, args: ["build", "-x", "test"], substantive: true });
    } else if (profile === "maven") {
      steps.push({ label: "Maven test", command: maven, args: ["test"], substantive: true });
      steps.push({ label: "Maven build", command: maven, args: ["package", "-DskipTests"], substantive: true });
    } else if (profile === "python") {
      steps.push({ label: "Python test", command: python, args: ["-m", "pytest"], substantive: true });
    } else if (profile === "go") {
      steps.push({ label: "Go test", command: "go", args: ["test", "./..."], substantive: true });
    } else if (profile === "rust") {
      steps.push({ label: "Rust test", command: "cargo", args: ["test", "--all-targets"], substantive: true });
    } else if (profile === "dotnet") {
      steps.push({ label: ".NET test", command: "dotnet", args: ["test"], substantive: true });
    } else if (profile === "node") {
      const npm = platform === "win32" ? "npm.cmd" : "npm";
      for (const step of createNodeVerificationSteps(packageScripts)) {
        steps.push({ ...step, command: npm, args: ["run", step.script] });
      }
    }
  }
  return steps;
}

function createQuickProfileStep(sentinel, options = {}) {
  const profileBySentinel = {
    __HARNESS_GRADLE_TEST__: "gradle",
    __HARNESS_MAVEN_TEST__: "maven",
    __HARNESS_PYTHON_TEST__: "python",
    __HARNESS_GO_TEST__: "go",
    __HARNESS_RUST_TEST__: "rust",
    __HARNESS_DOTNET_TEST__: "dotnet"
  };
  const profile = profileBySentinel[sentinel];
  if (!profile) return null;
  return createProfileVerificationSteps({ profiles: [profile], ...options })[0];
}

function shouldBlockVerificationFailure({ autoFixExhausted = false, apiDiagnosisAttempted = false }) {
  return autoFixExhausted || apiDiagnosisAttempted;
}
module.exports = {
  createProfileVerificationSteps,
  createQuickProfileStep,
  createNodeVerificationSteps,
  createQuickCacheKey,
  detectVerificationProfiles,
  inferQuickMappings,
  matchesPattern,
  selectQuickCommands,
  shouldBlockVerificationFailure,
  tokenizeCommand
};
