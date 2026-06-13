"use strict";

const crypto = require("crypto");

function cleanupManifestPayload(task, createdAt, files) {
  return { task, created_at: createdAt, files };
}

function cleanupManifestId(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 12);
}

function createCleanupManifest(task, createdAt, files) {
  const payload = cleanupManifestPayload(task, createdAt, files);
  return { id: cleanupManifestId(payload), ...payload };
}

function isCleanupManifestValid(manifest) {
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.files)) return false;
  return cleanupManifestId(cleanupManifestPayload(manifest.task, manifest.created_at, manifest.files)) === manifest.id;
}

function findGeneratedPaths(beforePaths, afterPaths) {
  const previous = new Set(beforePaths || []);
  return (afterPaths || []).filter((path) => !previous.has(path));
}

module.exports = {
  createCleanupManifest,
  findGeneratedPaths,
  isCleanupManifestValid
};
