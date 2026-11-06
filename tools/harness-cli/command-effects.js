"use strict";

// Unknown/new actions conservatively retain write-side bookkeeping.
const READ_ACTIONS = Object.freeze({
  request: ["show", "ready", "planning"],
  execution: ["status"],
  runner: ["status"],
  release: ["status"],
  deployment: ["list", "show"]
});

function isReadOnlyCommand(command, args = []) {
  return Boolean(READ_ACTIONS[command]?.includes(args[0]));
}

module.exports = { isReadOnlyCommand };
