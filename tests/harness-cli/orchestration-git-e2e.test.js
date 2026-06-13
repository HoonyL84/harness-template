"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const {
  integrateWorkers,
  prepareWorkers,
  recordWorker,
  saveRunState
} = require("../../tools/harness-cli/orchestration-command");
const { createOrchestrationState } = require("../../tools/harness-cli/orchestration-utils");

function runGit(cwd, args, allowFailure = false) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
  if (!allowFailure) {
    assert.equal(result.status, 0, result.error?.message || result.stderr || result.stdout);
  }
  return result;
}

function contentFingerprint(root) {
  const files = runGit(root, [
    "ls-files", "--cached", "--others", "--exclude-standard", "-z"
  ]).stdout.split("\0").filter(Boolean).sort();
  const hash = crypto.createHash("sha256");
  for (const rel of files) {
    const absolute = path.join(root, rel);
    if (!fs.existsSync(absolute)) continue;
    const stat = fs.lstatSync(absolute);
    hash.update(`\0${rel}\0`);
    if (stat.isSymbolicLink()) hash.update(`link:${fs.readlinkSync(absolute)}`);
    else if (stat.isFile()) hash.update(fs.readFileSync(absolute));
    else hash.update("non-file");
  }
  return hash.digest("hex");
}

const gitAvailable = spawnSync("git", ["--version"], {
  encoding: "utf8",
  windowsHide: true
}).status === 0;

test("real Git worktrees integrate two verified isolated workers", {
  skip: gitAvailable ? false : "Git process execution is unavailable"
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-orchestration-e2e-"));
  try {
    runGit(root, ["init", "-b", "codex/e2e"]);
    runGit(root, ["config", "user.email", "harness@example.com"]);
    runGit(root, ["config", "user.name", "Harness Test"]);
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "src", "a.txt"), "base-a\n");
    fs.writeFileSync(path.join(root, "src", "b.txt"), "base-b\n");
    fs.writeFileSync(path.join(root, ".gitignore"), [
      ".worktrees/",
      "observability/metrics/*.json"
    ].join("\n"));
    runGit(root, ["add", "."]);
    runGit(root, ["commit", "-m", "base"]);
    const baseCommit = runGit(root, ["rev-parse", "HEAD"]).stdout.trim();

    let state = saveRunState(root, {
      ...createOrchestrationState({
        runId: "e2e-20260613T000000Z",
        task: "demo",
        mode: "parallel",
        adapter: "native-host",
        baseCommit,
        parentBranch: "codex/e2e"
      }),
      phase: "implementation",
      status: "awaiting_implementation"
    });
    const planPath = path.join(root, "worker-plan.json");
    fs.writeFileSync(planPath, JSON.stringify({
      workers: [
        { id: "worker-a", owned_paths: ["src/a.txt"] },
        { id: "worker-b", owned_paths: ["src/b.txt"] }
      ]
    }));
    state = prepareWorkers(root, state, planPath, {
      allowMultiWriter: true,
      maxWorkers: 2
    });

    for (const worker of state.workers) {
      const worktree = path.join(root, worker.worktree);
      const ownedFile = path.join(worktree, worker.owned_paths[0]);
      fs.writeFileSync(ownedFile, `${worker.id}\n`);
      runGit(worktree, ["add", worker.owned_paths[0]]);
      runGit(worktree, ["commit", "-m", worker.id]);
      const commitSha = runGit(worktree, ["rev-parse", "HEAD"]).stdout.trim();
      const metricsDir = path.join(worktree, "observability", "metrics");
      fs.mkdirSync(metricsDir, { recursive: true });
      fs.writeFileSync(path.join(metricsDir, "demo.verify.json"), JSON.stringify({
        task: "demo",
        mode: "full",
        result: "pass",
        last_full: {
          result: "pass",
          verified_at: new Date().toISOString(),
          verified_commit: commitSha,
          content_fingerprint: contentFingerprint(worktree)
        }
      }));
      state = recordWorker(root, state, worker.id, commitSha);
    }

    state = integrateWorkers(root, state);
    const integration = path.join(root, state.integration.worktree);
    const readPortableText = (file) =>
      fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    assert.equal(readPortableText(path.join(integration, "src", "a.txt")), "worker-a\n");
    assert.equal(readPortableText(path.join(integration, "src", "b.txt")), "worker-b\n");
    assert.equal(state.phase, "review");
    assert.equal(state.status, "awaiting_review");
  } finally {
    const worktreeList = runGit(root, ["worktree", "list", "--porcelain"], true);
    if (worktreeList.status === 0) {
      const worktrees = worktreeList.stdout
        .split(/\r?\n/)
        .filter((line) => line.startsWith("worktree "))
        .map((line) => line.slice("worktree ".length))
        .filter((worktree) => path.resolve(worktree) !== path.resolve(root));
      for (const worktree of worktrees) {
        runGit(root, ["worktree", "remove", "--force", worktree], true);
      }
    }
    assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
