"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createProfileVerificationSteps,
  createQuickProfileStep,
  createNodeVerificationSteps,
  createQuickCacheKey,
  detectVerificationProfiles,
  inferQuickMappings,
  matchesPattern,
  selectQuickCommands,
  tokenizeCommand
} = require("../../tools/harness-cli/verify-utils");

test("globstar matches files directly below and nested below a root", () => {
  assert.equal(matchesPattern("src/app.js", "src/**/*.js"), true);
  assert.equal(matchesPattern("src/domain/app.js", "src/**/*.js"), true);
  assert.equal(matchesPattern("docs/app.js", "src/**/*.js"), false);
});

test("quoted command arguments remain a single token", () => {
  assert.deepEqual(
    tokenizeCommand("node -e \"process.stdout.write('hello world')\""),
    ["node", "-e", "process.stdout.write('hello world')"]
  );
});

test("quick mappings are inferred from package scripts", () => {
  const inferred = inferQuickMappings({ packageScripts: { test: "node --test", lint: "node --check app.js" } });
  assert.deepEqual(
    selectQuickCommands(["src/app.js"], {}, inferred),
    ["npm run test", "npm run lint"]
  );
});

test("verification profiles detect every product stack alongside the harness package", () => {
  assert.deepEqual(
    detectVerificationProfiles({
      rootFiles: [
        "package.json", "build.gradle", "pom.xml", "pyproject.toml",
        "go.mod", "Cargo.toml", "service.csproj"
      ],
      packageScripts: { test: "node --test" }
    }),
    ["gradle", "maven", "python", "go", "rust", "dotnet", "node"]
  );
});

test("profile verification creates substantive commands for every detected stack", () => {
  const steps = createProfileVerificationSteps({
    profiles: ["gradle", "maven", "python", "go", "rust", "dotnet", "node"],
    packageScripts: { test: "node --test", lint: "eslint .", build: "node build.js" },
    platform: "linux",
    hasJacoco: true
  });
  assert.deepEqual(
    steps.map((step) => `${step.command} ${step.args.join(" ")}`),
    [
      "./gradlew test",
      "./gradlew jacocoTestCoverageVerification",
      "./gradlew build -x test",
      "./mvnw test",
      "./mvnw package -DskipTests",
      "python3 -m pytest",
      "go test ./...",
      "cargo test --all-targets",
      "dotnet test",
      "npm run test",
      "npm run lint",
      "npm run build"
    ]
  );
  assert.equal(steps.every((step) => typeof step.substantive === "boolean"), true);
});

test("quick mappings include non-Node product profiles", () => {
  const inferred = inferQuickMappings({
    packageScripts: { test: "node --test" },
    profiles: ["maven", "python", "go", "rust", "dotnet", "node"]
  });
  assert.deepEqual(selectQuickCommands(["src/service.py"], {}, inferred), ["__HARNESS_PYTHON_TEST__"]);
  assert.deepEqual(selectQuickCommands(["src/main.rs"], {}, inferred), ["__HARNESS_RUST_TEST__"]);
  assert.deepEqual(selectQuickCommands(["src/App.cs"], {}, inferred), ["__HARNESS_DOTNET_TEST__"]);
  assert.deepEqual(selectQuickCommands(["go.mod"], {}, inferred), ["__HARNESS_GO_TEST__"]);
  assert.deepEqual(selectQuickCommands(["service.csproj"], {}, inferred), ["__HARNESS_DOTNET_TEST__"]);
});

test("quick profile sentinels resolve platform-specific commands", () => {
  assert.deepEqual(
    createQuickProfileStep("__HARNESS_GRADLE_TEST__", { platform: "win32" }),
    { label: "Gradle test", command: "gradlew.bat", args: ["test"], substantive: true }
  );
  assert.deepEqual(
    createQuickProfileStep("__HARNESS_MAVEN_TEST__", { platform: "win32", hasMavenWrapper: false }),
    { label: "Maven test", command: "mvn.cmd", args: ["test"], substantive: true }
  );
  assert.equal(createQuickProfileStep("npm run test"), null);
});

test("configured quick mappings take precedence over inferred mappings", () => {
  const commands = selectQuickCommands(
    ["src/app.js"],
    { "src/**/*.js": ["npm run custom"] },
    { "src/**/*.js": ["npm run test"] }
  );
  assert.deepEqual(commands, ["npm run custom"]);
});

test("unmatched documentation changes remain inconclusive", () => {
  const inferred = inferQuickMappings({ packageScripts: { test: "node --test" } });
  assert.deepEqual(selectQuickCommands(["docs/guide.md"], {}, inferred), []);
});

test("Node verification plan removes build aliases that repeat lint", () => {
  assert.deepEqual(
    createNodeVerificationSteps({
      coverage: "c8 node tests.js",
      lint: "eslint .",
      build: "npm run lint"
    }).map((step) => step.script),
    ["coverage", "lint"]
  );
});

test("quick cache key changes with content, command, or runtime", () => {
  const base = {
    contentFingerprint: "content-a",
    commands: ["npm run test"],
    nodeVersion: "v22",
    platform: "win32",
    arch: "x64"
  };
  assert.equal(createQuickCacheKey(base), createQuickCacheKey({ ...base }));
  assert.notEqual(
    createQuickCacheKey(base),
    createQuickCacheKey({ ...base, contentFingerprint: "content-b" })
  );
});
