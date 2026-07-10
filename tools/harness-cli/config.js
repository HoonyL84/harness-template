"use strict";

const fs = require("fs");
const path = require("path");

const DEFAULT_AUTO_FIX_ROOTS = ["src", "app", "lib", "test", "tests", "__tests__"];
const DEFAULT_AUTO_FIX_FORBIDDEN_SEGMENTS = [
  ".git", ".github", ".harness", ".venv", "build", "coverage", "dist", "docs",
  "evals", "infra", "memory", "migrations", "node_modules", "observability",
  "prompts", "scripts", "target", "terraform", "tools", "vendor", "venv"
];
const DEFAULT_PROTECTED_FILES = [
  ".env", ".env.local", "docker-compose.yml", "docker-compose.yaml", "dockerfile",
  "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock",
  "pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts"
];
const DEFAULT_L5_PROTECTED_SEGMENTS = [".git", ".harness", "observability", "node_modules", ".venv", "venv"];
const DEFAULT_L5_HIGH_RISK_SEGMENTS = [
  ".github", "deploy", "deployment", "helm", "infra", "k8s", "kubernetes",
  "migrations", "scripts", "terraform"
];

const IMMUTABLE_AUTO_FIX_FORBIDDEN_FILES = [".env", ".env.local", "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"];
const IMMUTABLE_AUTO_FIX_FORBIDDEN_SEGMENTS = [".git", ".harness", "node_modules", "tools"];
const IMMUTABLE_L5_PROTECTED_SEGMENTS = [".git", ".harness", "observability", "node_modules"];
const IMMUTABLE_L5_HIGH_RISK_FILES = [".env", ".env.local", "package.json", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"];
const MULTI_AGENT_MODES = new Set(["auto", "native", "api", "sequential"]);
const MULTI_AGENT_ADAPTERS = new Set(["auto", "native-host", "provider-api", "sequential-local"]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireStringArray(value, label, fail) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    fail(`${label} must be an array of non-empty strings.`);
  }
  return value;
}

function requirePositiveNumber(value, label, fail, { allowZero = false } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || (allowZero ? number < 0 : number <= 0)) {
    fail(`${label} must be ${allowZero ? "a non-negative" : "a positive"} number.`);
  }
  return number;
}

function validateConfigSchema(config, fail) {
  if (!isPlainObject(config)) fail(".harness/config.json must contain a JSON object.");
  if (config.config_version !== "1.0") {
    fail(`Unsupported config_version in .harness/config.json: ${config.config_version}`);
  }

  for (const section of ["verify", "limits", "api", "auto_fix", "l5", "multi_agent"]) {
    if (config[section] !== undefined && !isPlainObject(config[section])) {
      fail(`${section} must be a JSON object.`);
    }
  }

  if (config.verify?.quick !== undefined) {
    if (!isPlainObject(config.verify.quick)) fail("verify.quick must be a JSON object.");
    for (const [pattern, commands] of Object.entries(config.verify.quick)) {
      if (!pattern.trim()) fail("verify.quick patterns must not be empty.");
      requireStringArray(commands, `verify.quick["${pattern}"]`, fail);
    }
  }
  if (config.verify?.full !== undefined) requireStringArray(config.verify.full, "verify.full", fail);
  if (config.verify?.quick_cache !== undefined && typeof config.verify.quick_cache !== "boolean") {
    fail("verify.quick_cache must be a boolean.");
  }
  if (config.verify?.parallel_scripts !== undefined) {
    requireStringArray(config.verify.parallel_scripts, "verify.parallel_scripts", fail);
  }

  const numericFields = [
    ["limits.max_iterations", config.limits?.max_iterations],
    ["limits.max_api_calls", config.limits?.max_api_calls],
    ["limits.max_runtime_minutes", config.limits?.max_runtime_minutes],
    ["limits.max_patch_kb", config.limits?.max_patch_kb],
    ["limits.max_files", config.limits?.max_files],
    ["api.max_retries", config.api?.max_retries, true],
    ["api.retry_base_ms", config.api?.retry_base_ms, true],
    ["api.retry_max_ms", config.api?.retry_max_ms, true],
    ["api.max_provider_requests", config.api?.max_provider_requests]
  ];
  for (const [label, value, allowZero = false] of numericFields) {
    if (value !== undefined) requirePositiveNumber(value, label, fail, { allowZero });
  }

  for (const [section, fields] of Object.entries({
    auto_fix: ["allowed_roots", "forbidden_segments", "forbidden_files"],
    l5: ["protected_segments", "high_risk_segments", "high_risk_files"]
  })) {
    for (const field of fields) {
      if (config[section]?.[field] !== undefined) {
        requireStringArray(config[section][field], `${section}.${field}`, fail);
      }
    }
  }

  if (config.multi_agent?.enabled !== undefined && typeof config.multi_agent.enabled !== "boolean") {
    fail("multi_agent.enabled must be a boolean.");
  }
  if (config.multi_agent?.default_mode !== undefined
      && !MULTI_AGENT_MODES.has(config.multi_agent.default_mode)) {
    fail(`multi_agent.default_mode must be one of ${Array.from(MULTI_AGENT_MODES).join(", ")}.`);
  }
  if (config.multi_agent?.adapter !== undefined
      && !MULTI_AGENT_ADAPTERS.has(config.multi_agent.adapter)) {
    fail(`multi_agent.adapter must be one of ${Array.from(MULTI_AGENT_ADAPTERS).join(", ")}.`);
  }
  if (config.multi_agent?.max_workers !== undefined) {
    const maxWorkers = requirePositiveNumber(
      config.multi_agent.max_workers,
      "multi_agent.max_workers",
      fail
    );
    if (!Number.isInteger(maxWorkers) || maxWorkers > 8) {
      fail("multi_agent.max_workers must be an integer between 1 and 8.");
    }
  }
  if (config.multi_agent?.allow_multi_writer !== undefined
      && typeof config.multi_agent.allow_multi_writer !== "boolean") {
    fail("multi_agent.allow_multi_writer must be a boolean.");
  }
}

function createConfigLoader({ root, argv = process.argv, env = process.env, fail }) {
  let cachedConfig = null;

  return function loadConfig() {
    if (cachedConfig) return cachedConfig;

    const configPath = path.join(root, ".harness", "config.json");
    let fileConfig = {};
    if (fs.existsSync(configPath)) {
      try {
        fileConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
        validateConfigSchema(fileConfig, fail);
      } catch (error) {
        const bypassCommands = new Set(["help", "--help", "-h", "version", "--version", "-v", undefined]);
        if (bypassCommands.has(argv[2])) fileConfig = {};
        else fail(`Failed to load or parse .harness/config.json: ${error.message}`);
      }
    }

    const numberSetting = (envName, configValue, fallback, options) =>
      requirePositiveNumber(env[envName] || configValue || fallback, envName, fail, options);
    const normalize = (value) => value.replace(/\\/g, "/").toLowerCase().trim();
    const union = (immutable, configured) => new Set([...immutable, ...configured.map(normalize)]);
    const booleanSetting = (envName, configValue, fallback) => {
      const raw = env[envName];
      if (raw === undefined || raw === "") return configValue ?? fallback;
      if (raw === "true") return true;
      if (raw === "false") return false;
      fail(`${envName} must be true or false.`);
    };
    const enumSetting = (envName, configValue, fallback, allowed) => {
      const value = String(env[envName] || configValue || fallback);
      if (!allowed.has(value)) {
        fail(`${envName} must be one of ${Array.from(allowed).join(", ")}.`);
      }
      return value;
    };

    const parallelScripts = env.HARNESS_VERIFY_PARALLEL_SCRIPTS
      ? env.HARNESS_VERIFY_PARALLEL_SCRIPTS.split(",").map((item) => item.trim()).filter(Boolean)
      : (fileConfig.verify?.parallel_scripts || []);

    cachedConfig = {
      verify: {
        quick: fileConfig.verify?.quick || {},
        full: fileConfig.verify?.full || [],
        quickCache: booleanSetting(
          "HARNESS_VERIFY_QUICK_CACHE",
          fileConfig.verify?.quick_cache,
          true
        ),
        parallelScripts: new Set(parallelScripts)
      },
      limits: {
        maxIterations: numberSetting("HARNESS_MAX_ITERATIONS", fileConfig.limits?.max_iterations, "3"),
        maxApiCalls: numberSetting("HARNESS_MAX_API_CALLS", fileConfig.limits?.max_api_calls, "6"),
        maxRuntimeMinutes: numberSetting("HARNESS_MAX_RUNTIME_MINUTES", fileConfig.limits?.max_runtime_minutes, "30"),
        maxPatchKb: numberSetting("HARNESS_L5_MAX_PATCH_KB", fileConfig.limits?.max_patch_kb, "500"),
        maxFiles: numberSetting("HARNESS_L5_MAX_FILES", fileConfig.limits?.max_files, "20")
      },
      api: {
        maxRetries: numberSetting("HARNESS_API_MAX_RETRIES", fileConfig.api?.max_retries, "3", { allowZero: true }),
        retryBaseMs: numberSetting("HARNESS_API_RETRY_BASE_MS", fileConfig.api?.retry_base_ms, "1000", { allowZero: true }),
        retryMaxMs: numberSetting("HARNESS_API_RETRY_MAX_MS", fileConfig.api?.retry_max_ms, "30000", { allowZero: true }),
        maxProviderRequests: numberSetting("HARNESS_MAX_PROVIDER_REQUESTS", fileConfig.api?.max_provider_requests, "12")
      },
      auto_fix: {
        allowedRoots: new Set((fileConfig.auto_fix?.allowed_roots || DEFAULT_AUTO_FIX_ROOTS).map(normalize)),
        forbiddenSegments: union(
          IMMUTABLE_AUTO_FIX_FORBIDDEN_SEGMENTS,
          fileConfig.auto_fix?.forbidden_segments || DEFAULT_AUTO_FIX_FORBIDDEN_SEGMENTS
        ),
        forbiddenFiles: union(
          IMMUTABLE_AUTO_FIX_FORBIDDEN_FILES,
          fileConfig.auto_fix?.forbidden_files || DEFAULT_PROTECTED_FILES
        )
      },
      l5: {
        protectedSegments: union(
          IMMUTABLE_L5_PROTECTED_SEGMENTS,
          fileConfig.l5?.protected_segments || DEFAULT_L5_PROTECTED_SEGMENTS
        ),
        highRiskSegments: new Set((fileConfig.l5?.high_risk_segments || DEFAULT_L5_HIGH_RISK_SEGMENTS).map(normalize)),
        highRiskFiles: union(
          IMMUTABLE_L5_HIGH_RISK_FILES,
          fileConfig.l5?.high_risk_files || DEFAULT_PROTECTED_FILES
        )
      },
      multiAgent: {
        enabled: booleanSetting(
          "HARNESS_MULTI_AGENT_ENABLED",
          fileConfig.multi_agent?.enabled,
          false
        ),
        defaultMode: enumSetting(
          "HARNESS_MULTI_AGENT_MODE",
          fileConfig.multi_agent?.default_mode,
          "sequential",
          MULTI_AGENT_MODES
        ),
        adapter: enumSetting(
          "HARNESS_AGENT_ADAPTER",
          fileConfig.multi_agent?.adapter,
          "auto",
          MULTI_AGENT_ADAPTERS
        ),
        maxWorkers: numberSetting(
          "HARNESS_MULTI_AGENT_MAX_WORKERS",
          fileConfig.multi_agent?.max_workers,
          "2"
        ),
        allowMultiWriter: booleanSetting(
          "HARNESS_MULTI_AGENT_ALLOW_MULTI_WRITER",
          fileConfig.multi_agent?.allow_multi_writer,
          false
        )
      }
    };
    if (!Number.isInteger(cachedConfig.multiAgent.maxWorkers)
        || cachedConfig.multiAgent.maxWorkers > 8) {
      fail("HARNESS_MULTI_AGENT_MAX_WORKERS must be an integer between 1 and 8.");
    }
    return cachedConfig;
  };
}

module.exports = {
  createConfigLoader,
  isPlainObject,
  validateConfigSchema
};
