"use strict";

const COMMAND_METADATA = Object.freeze({
  "check": { requiresGit: false },
  "check-environment": { requiresGit: false },
  "create-ticket": { requiresGit: false },
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

function getCommandMetadata(command) {
  return COMMAND_METADATA[command || "help"] || { requiresGit: false };
}

function shouldBypassConfig(command) {
  return CONFIG_BYPASS_COMMANDS.has(command);
}

module.exports = {
  getCommandMetadata,
  shouldBypassConfig
};
