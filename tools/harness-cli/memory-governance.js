"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MEMORY_LAYERS = ["working", "semantic", "episodic", "procedural"];
const ALLOWED_SOURCES = ["manual", "agent", "postmortem"];
const REQUIRED_FIELDS = ["id", "layer", "title", "owner", "created_at", "updated_at", "tags", "source"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_NOTE_BYTES = 256 * 1024;
const IGNORED_FILES = new Set(["README.md", "MEMORY_TEMPLATE.md"]);

/**
 * Parse YAML-like frontmatter from a Markdown memory document.
 * @param {string} content
 * @returns {Record<string, string>|null}
 */
function parseFrontmatter(content) {
  const normalized = String(content || "").replace(/^\uFEFF/, "");
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return null;
  const fields = {};
  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    fields[key] = val;
  }
  return fields;
}

/**
 * Validate a single parsed memory document's frontmatter against `docs/design-docs/memory-governance.md`.
 * @param {string} content
 * @param {string} expectedLayer
 * @returns {string[]} List of validation errors (empty if valid)
 */
function validateMemoryContent(content, expectedLayer) {
  const errors = [];
  if (!MEMORY_LAYERS.includes(expectedLayer)) {
    errors.push(`Unknown memory layer: ${expectedLayer}`);
    return errors;
  }
  const fields = parseFrontmatter(content);
  if (!fields) {
    errors.push("Missing YAML frontmatter block (--- ... ---)");
    return errors;
  }
  for (const key of REQUIRED_FIELDS) {
    if (!fields[key]) {
      errors.push(`Missing required frontmatter field: ${key}`);
    }
  }
  if (fields.layer && fields.layer !== expectedLayer) {
    errors.push(`Frontmatter layer '${fields.layer}' does not match directory layer '${expectedLayer}'`);
  }
  if (fields.created_at && !DATE_RE.test(fields.created_at)) {
    errors.push(`Invalid created_at date (expected YYYY-MM-DD): ${fields.created_at}`);
  }
  if (fields.updated_at && !DATE_RE.test(fields.updated_at)) {
    errors.push(`Invalid updated_at date (expected YYYY-MM-DD): ${fields.updated_at}`);
  }
  if (fields.source && !ALLOWED_SOURCES.includes(fields.source)) {
    errors.push(`Invalid source '${fields.source}' (expected manual|agent|postmortem)`);
  }
  if (fields.tags && (!fields.tags.startsWith("[") || !fields.tags.endsWith("]"))) {
    errors.push("Frontmatter tags must be a bracketed list, e.g. [tag1, tag2]");
  }
  return errors;
}

/**
 * Scan and validate all Markdown memory notes under `memory/{working,semantic,episodic,procedural}`.
 * Ignores `README.md` and `MEMORY_TEMPLATE.md`. Rejects symlinks and oversized files.
 * @param {string} [rootDir]
 * @returns {{ ok: boolean, checked: number, files: Array<{ file: string, layer: string, ok: boolean, errors: string[] }> }}
 */
function validateMemoryDirectory(rootDir = path.resolve(__dirname, "../..")) {
  const memoryRoot = path.join(rootDir, "memory");
  const files = [];
  if (!fs.existsSync(memoryRoot)) {
    return { ok: true, checked: 0, files };
  }
  if (fs.lstatSync(memoryRoot).isSymbolicLink()) {
    throw new Error("Unsafe symlink or junction rejected for memory root");
  }

  for (const layer of MEMORY_LAYERS) {
    const layerDir = path.join(memoryRoot, layer);
    if (!fs.existsSync(layerDir)) continue;
    const layerStat = fs.lstatSync(layerDir);
    if (layerStat.isSymbolicLink()) {
      throw new Error(`Unsafe symlink or junction rejected for memory/${layer}`);
    }
    if (!layerStat.isDirectory()) continue;

    const entries = fs.readdirSync(layerDir).filter(name => name.endsWith(".md") && !IGNORED_FILES.has(name)).sort();
    for (const name of entries) {
      const fullPath = path.join(layerDir, name);
      const relPath = `memory/${layer}/${name}`;
      const stat = fs.lstatSync(fullPath);
      if (stat.isSymbolicLink()) {
        files.push({ file: relPath, layer, ok: false, errors: ["Unsafe symlink or junction rejected"] });
        continue;
      }
      if (!stat.isFile() || stat.size > MAX_NOTE_BYTES) {
        files.push({ file: relPath, layer, ok: false, errors: ["Memory note must be a regular file <=256KB"] });
        continue;
      }
      const content = fs.readFileSync(fullPath, "utf8");
      const errors = validateMemoryContent(content, layer);
      files.push({ file: relPath, layer, ok: errors.length === 0, errors });
    }
  }

  return {
    ok: files.every(item => item.ok),
    checked: files.length,
    files
  };
}

module.exports = {
  ALLOWED_SOURCES,
  MEMORY_LAYERS,
  REQUIRED_FIELDS,
  parseFrontmatter,
  validateMemoryContent,
  validateMemoryDirectory
};
