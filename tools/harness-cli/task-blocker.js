"use strict";

const fs = require("node:fs");
const path = require("node:path");

function blockActiveTask({ root, taskId, failedStep, reason, now = new Date() }) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(taskId)) {
    throw new Error(`Cannot block invalid task id: ${taskId}`);
  }

  const activePath = path.join(root, ".harness", "tasks", "active", `${taskId}.md`);
  const blockedDir = path.join(root, ".harness", "tasks", "blocked");
  const blockedPath = path.join(blockedDir, `${taskId}.md`);
  if (!fs.existsSync(activePath)) return { moved: false, relativePath: null };
  if (fs.existsSync(blockedPath)) throw new Error(`Blocked ticket already exists: ${taskId}`);

  fs.mkdirSync(blockedDir, { recursive: true });
  fs.renameSync(activePath, blockedPath);
  const command = `${failedStep.command} ${failedStep.stepArgs.join(" ")}`.trim();
  const history = `
## Blocked History (Auto-generated)
- Blocked At: ${now.toISOString()}
- Reason: ${reason}
- Failed Step: ${failedStep.label}
- Command: \`${command}\`
- Stderr snippet:
\`\`\`text
${String(failedStep.stderr || "").trim().slice(-1000)}
\`\`\`
`;
  fs.appendFileSync(blockedPath, history, "utf8");
  return {
    moved: true,
    relativePath: `.harness/tasks/blocked/${taskId}.md`
  };
}

module.exports = { blockActiveTask };
