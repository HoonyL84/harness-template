"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function updateFileHash(hash, filePath) {
  const handle = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(handle, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(handle);
  }
}

function repositoryContentFingerprint(root, runGit) {
  const result = runGit(["ls-files", "--cached", "--others", "--exclude-standard", "-z"], root);
  if (result.status !== 0 || result.error) return null;
  const status = runGit(["status", "--porcelain=v1", "-z", "--ignore-submodules=none"], root);
  if (status.status !== 0 || status.error) return null;

  const hash = crypto.createHash("sha256");
  hash.update(String(status.stdout || ""));
  const paths = String(result.stdout || "").split("\0").filter(Boolean).sort();
  for (const relativePath of paths) {
    const absolutePath = path.resolve(root, relativePath);
    const relativeToRoot = path.relative(root, absolutePath);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) return null;
    hash.update(`\0${relativePath.split(path.sep).join("/")}\0`);
    if (!fs.existsSync(absolutePath)) {
      hash.update("missing");
      continue;
    }
    const stat = fs.lstatSync(absolutePath);
    if (stat.isSymbolicLink()) hash.update(`link:${fs.readlinkSync(absolutePath)}`);
    else if (stat.isFile()) updateFileHash(hash, absolutePath);
    else hash.update("non-file");
  }
  return hash.digest("hex");
}

module.exports = { repositoryContentFingerprint };
