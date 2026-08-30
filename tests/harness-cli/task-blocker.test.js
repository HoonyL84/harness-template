"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { blockActiveTask } = require("../../tools/harness-cli/task-blocker");

test("blocking moves the active ticket and records failure evidence", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-block-"));
  const activeDir = path.join(root, ".harness", "tasks", "active");
  fs.mkdirSync(activeDir, { recursive: true });
  fs.writeFileSync(path.join(activeDir, "sample-ticket.md"), "# Sample\n", "utf8");

  const result = blockActiveTask({
    root,
    taskId: "sample-ticket",
    failedStep: {
      label: "Node test",
      command: "npm",
      stepArgs: ["test"],
      stderr: "Assertion failed"
    },
    reason: "Auto-fix attempts exhausted",
    now: new Date("2026-08-29T00:00:00.000Z")
  });

  assert.equal(result.moved, true);
  assert.equal(fs.existsSync(path.join(activeDir, "sample-ticket.md")), false);
  const blocked = fs.readFileSync(
    path.join(root, ".harness", "tasks", "blocked", "sample-ticket.md"),
    "utf8"
  );
  assert.match(blocked, /Auto-fix attempts exhausted/);
  assert.match(blocked, /Assertion failed/);
});

test("blocking rejects task ids that could escape the task directory", () => {
  assert.throws(() => blockActiveTask({
    root: os.tmpdir(),
    taskId: "../outside",
    failedStep: { label: "test", command: "npm", stepArgs: [], stderr: "" },
    reason: "test"
  }), /invalid task id/);
});
