"use strict";

const fs = require("fs");
const path = require("path");
const {
  readState,
  stateFingerprint,
  writeJsonAtomic
} = require("./orchestration-utils");

const LOCK_TTL_MS = 10 * 60 * 1000;

function stateDir(root, runId) {
  if (!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(String(runId || ""))) {
    throw new Error("Orchestration run id is invalid.");
  }
  return path.join(root, "observability", "orchestration", runId);
}

function statePath(root, runId) {
  return path.join(stateDir(root, runId), "state.json");
}

function readRunState(root, runId) {
  const filePath = statePath(root, runId);
  if (!fs.existsSync(filePath)) throw new Error(`Orchestration run not found: ${runId}`);
  return readState(filePath);
}

function createStateLock(lockPath) {
  const descriptor = fs.openSync(lockPath, "wx");
  fs.writeFileSync(descriptor, JSON.stringify({
    pid: process.pid,
    created_at: new Date().toISOString()
  }));
  return descriptor;
}

function lockOwnerIsAlive(pid) {
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}

function acquireStateLock(lockPath) {
  try {
    return createStateLock(lockPath);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    let stale = false;
    try {
      const metadata = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      const ageMs = Date.now() - Date.parse(metadata.created_at);
      stale = Number.isFinite(ageMs) && ageMs > LOCK_TTL_MS && !lockOwnerIsAlive(metadata.pid);
    } catch {
      stale = false;
    }
    if (!stale) {
      throw new Error("Orchestration state is being updated by another process. Retry shortly.");
    }
    fs.unlinkSync(lockPath);
    return createStateLock(lockPath);
  }
}

function saveRunState(root, state, patch = {}) {
  const filePath = statePath(root, state.run_id);
  const lockPath = `${filePath}.lock`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let lock;
  try {
    lock = acquireStateLock(lockPath);
    if (fs.existsSync(filePath)) {
      const current = readState(filePath);
      if (!state.state_fingerprint || current.state_fingerprint !== state.state_fingerprint) {
        throw new Error("Orchestration state changed concurrently. Reload the run and retry.");
      }
    }
    const next = { ...state, ...patch, updated_at: new Date().toISOString() };
    next.state_fingerprint = stateFingerprint({ ...next, state_fingerprint: undefined });
    writeJsonAtomic(filePath, next);
    return next;
  } finally {
    if (lock !== undefined) fs.closeSync(lock);
    if (lock !== undefined && fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  }
}

function listTaskRuns(root, task) {
  const baseDir = path.join(root, "observability", "orchestration");
  if (!fs.existsSync(baseDir)) return [];
  return fs.readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      try {
        return readRunState(root, entry.name);
      } catch {
        return null;
      }
    })
    .filter((state) => state?.task === task);
}

function requireTaskOrchestrationReady(root, task) {
  const unfinished = listTaskRuns(root, task)
    .filter((state) => state.status !== "ready_to_complete");
  if (unfinished.length > 0) {
    throw new Error(
      `Task has unfinished orchestration runs: ${unfinished.map((state) => state.run_id).join(", ")}`
    );
  }
}

function runtimeNow(config) {
  return typeof config.now === "function" ? new Date(config.now()) : new Date();
}

function requireRuntimeBudget(root, state, config) {
  const deadline = Date.parse(state.budget?.deadline_at || "");
  if (!Number.isFinite(deadline)) {
    throw new Error("Orchestration runtime budget metadata is missing.");
  }
  if (runtimeNow(config).getTime() > deadline) {
    saveRunState(root, state, {
      status: "budget_exhausted",
      budget_exhausted_reason: "runtime"
    });
    throw new Error("Orchestration runtime budget is exhausted.");
  }
}

function reserveProviderBudget(root, state, count, config) {
  requireRuntimeBudget(root, state, config);
  const used = Number(state.budget?.api_calls || 0);
  const limit = Number(state.budget?.max_api_calls || 0);
  if (!Number.isInteger(count) || count < 1 || !Number.isFinite(limit) || used + count > limit) {
    saveRunState(root, state, {
      status: "budget_exhausted",
      budget_exhausted_reason: "api_calls"
    });
    throw new Error(`Orchestration API call budget exhausted (${used}/${limit}).`);
  }
  return saveRunState(root, state, {
    budget: {
      ...state.budget,
      api_calls: used + count
    }
  });
}

module.exports = {
  listTaskRuns,
  readRunState,
  requireRuntimeBudget,
  requireTaskOrchestrationReady,
  reserveProviderBudget,
  runtimeNow,
  saveRunState,
  stateDir,
  statePath
};
