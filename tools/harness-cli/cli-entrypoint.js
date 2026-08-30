"use strict";

const COMMAND_METADATA = Object.freeze({
  "check": { requiresGit: false },
  "check-environment": { requiresGit: false },
  "create-ticket": { requiresGit: false },
  "bootstrap": { requiresGit: false },
  "project": { requiresGit: false },
  "request": { requiresGit: false },
  "execution": { requiresGit: false },
  "runner": { requiresGit: false },
  "release": { requiresGit: false },
  "evidence": { requiresGit: false },
  "deployment": { requiresGit: false },
  "dashboard": { requiresGit: false },
  "start-ticket": { requiresGit: true },
  "complete-task": { requiresGit: true },
  "verify": { requiresGit: true },
  "run-agent": { requiresGit: true },
  "scan-drift": { requiresGit: true },
  "recover": { requiresGit: true },
  "autonomy": { requiresGit: true },
  "orchestrate": { requiresGit: false },
  "cleanup": { requiresGit: true },
  "validate-auto-fix": { requiresGit: false },
  "validate-l5-patch": { requiresGit: false },
  "validate-prompts": { requiresGit: false },
  "validate-api-retry": { requiresGit: false },
  "validate-recovery": { requiresGit: false },
  "validate-l5-soak": { requiresGit: false },
  "help": { requiresGit: false },
  "--help": { requiresGit: false },
  "-h": { requiresGit: false },
  "version": { requiresGit: false },
  "--version": { requiresGit: false },
  "-v": { requiresGit: false }
});
const CONFIG_BYPASS_COMMANDS = new Set(["help", "--help", "-h", "version", "--version", "-v", undefined]);
const RUNTIME_MANAGED_ENV_VARS = new Set([
  "PATH", "PATHEXT", "PWD", "HOME", "SHELL", "USER",
  "LANG", "PORT", "NODE_ENV", "NODE_V8_COVERAGE", "TEMP", "TMP"
]);
const COMMAND_ALIASES = Object.freeze({
  "--help": "help",
  "-h": "help",
  "--version": "version",
  "-v": "version"
});

function getCommandMetadata(command) {
  return COMMAND_METADATA[command || "help"] || { requiresGit: false };
}

function shouldBypassConfig(command) {
  return CONFIG_BYPASS_COMMANDS.has(command);
}

function isRuntimeManagedEnv(name) {
  return RUNTIME_MANAGED_ENV_VARS.has(name);
}

async function dispatchCommand(command, args, handlers, afterDispatch) {
  const canonical = COMMAND_ALIASES[command] || command || "help";
  const handler = handlers[canonical];
  if (!handler) return false;
  try {
    const result = await handler(args);
    if (afterDispatch) await afterDispatch(canonical, args, result, null);
  } catch (error) {
    if (afterDispatch) await afterDispatch(canonical, args, null, error);
    throw error;
  }
  return true;
}

module.exports = {
  dispatchCommand,
  getCommandMetadata,
  isRuntimeManagedEnv,
  shouldBypassConfig
};
