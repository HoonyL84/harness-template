"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_LOCK_TTL_MS = 30_000;

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`State file is invalid JSON (${filePath}): ${error.message}`);
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomUUID()}`;
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true });
  }
  return value;
}

function readLock(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

function acquireFileLock(filePath, options = {}) {
  const ttlMs = Number(options.ttlMs ?? DEFAULT_LOCK_TTL_MS);
  const now = Number(options.now?.() ?? Date.now());
  if (!Number.isFinite(ttlMs) || ttlMs < 1) throw new Error("State lock TTL must be a positive number");
  const lockPath = `${filePath}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const token = crypto.randomUUID();
  const record = { token, pid: process.pid, acquired_at: new Date(now).toISOString(), expires_at: new Date(now + ttlMs).toISOString() };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lockPath, "wx", 0o600);
      try { fs.writeFileSync(fd, `${JSON.stringify(record)}\n`); } finally { fs.closeSync(fd); }
      return { lockPath, token };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const current = readLock(lockPath);
      const expiresAt = Date.parse(current?.expires_at || "");
      if (Number.isFinite(expiresAt) && expiresAt > now) {
        throw new Error(`State is locked by another writer: ${path.basename(filePath)}`);
      }
      if (!Number.isFinite(expiresAt)) {
        let ageMs;
        try { ageMs = now - fs.statSync(lockPath).mtimeMs; } catch (statError) {
          if (statError.code === "ENOENT") continue;
          throw statError;
        }
        if (ageMs < ttlMs) throw new Error(`State is locked by another writer: ${path.basename(filePath)}`);
      }
      const stalePath = `${lockPath}.stale-${process.pid}-${token}`;
      try {
        fs.renameSync(lockPath, stalePath);
        fs.rmSync(stalePath, { force: true });
      } catch (reclaimError) {
        if (!["ENOENT", "EACCES", "EPERM"].includes(reclaimError.code)) throw reclaimError;
      }
    }
  }
  throw new Error(`Could not acquire state lock: ${path.basename(filePath)}`);
}

function releaseFileLock(lock) {
  const current = readLock(lock.lockPath);
  if (current?.token === lock.token) fs.rmSync(lock.lockPath, { force: true });
}

function withFileLock(filePath, callback, options = {}) {
  const lock = acquireFileLock(filePath, options);
  try {
    return callback();
  } finally {
    releaseFileLock(lock);
  }
}

async function withFileLockAsync(filePath, callback, options = {}) {
  const lock = acquireFileLock(filePath, options);
  try {
    return await callback();
  } finally {
    releaseFileLock(lock);
  }
}

function updateJsonLocked(filePath, fallback, update, options = {}) {
  return withFileLock(filePath, () => {
    const current = readJson(filePath, fallback);
    const next = update(current);
    if (next === undefined) throw new Error("State updater must return the next value");
    return writeJsonAtomic(filePath, next);
  }, options);
}

function readJsonDirectory(directory) {
  return fs.existsSync(directory)
    ? fs.readdirSync(directory).filter((name) => name.endsWith(".json")).sort().map((name) => readJson(path.join(directory, name), null))
    : [];
}

module.exports = {
  acquireFileLock,
  readJson,
  readJsonDirectory,
  releaseFileLock,
  updateJsonLocked,
  withFileLock,
  withFileLockAsync,
  writeJsonAtomic
};
