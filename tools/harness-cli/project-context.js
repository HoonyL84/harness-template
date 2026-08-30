"use strict";

const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");

const DEFAULT_MAX_BYTES = 256 * 1024;
const DEFAULT_MAX_FILES = 40;
const CONTEXT_SOURCES = Object.freeze([
  { relativePath: "AGENTS.md", category: "instructions", priority: 0 },
  { relativePath: "docs/project/PLANS.md", category: "plan", priority: 1 },
  { relativePath: "docs/project/OVERVIEW.md", category: "overview", priority: 2 },
  { relativePath: ".harness/tasks/active", category: "active-task", priority: 3, directory: true },
  { relativePath: "docs/design-docs", category: "design", priority: 4, directory: true },
  { relativePath: "docs/adr", category: "adr", priority: 5, directory: true },
  { relativePath: "memory/working", category: "working-memory", priority: 6, directory: true },
  { relativePath: "memory/semantic", category: "semantic-memory", priority: 7, directory: true },
  { relativePath: "memory/procedural", category: "procedural-memory", priority: 8, directory: true },
  { relativePath: "memory/episodic", category: "episodic-memory", priority: 9, directory: true },
  { relativePath: "README.md", category: "readme", priority: 10 }
]);

function normalizedRelative(root, candidate) {
  const relative = path.relative(root, candidate);
  if (!relative || relative === ".") return "";
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  return relative.split(path.sep).join("/");
}

function collectMarkdownFiles(root, directory) {
  const files = [];
  const realRoot = fs.realpathSync(root);
  const visit = (current) => {
    if (normalizedRelative(realRoot, fs.realpathSync(current)) === null) {
      throw new Error("Context directory escaped the project root through a symbolic link");
    }
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) files.push(absolute);
    }
  };
  if (normalizedRelative(root, directory) === null) throw new Error("Context directory escaped the project root");
  visit(directory);
  return files;
}

function discoverProjectContext(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`Project path is not a directory: ${root}`);
  }
  const maxFiles = Number(options.maxFiles ?? DEFAULT_MAX_FILES);
  if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 200) {
    throw new Error("Context max files must be an integer between 1 and 200");
  }
  const discovered = [];
  const seen = new Set();
  const realRoot = fs.realpathSync(root);

  for (const source of CONTEXT_SOURCES) {
    const absolute = path.resolve(root, source.relativePath);
    if (normalizedRelative(root, absolute) === null || !fs.existsSync(absolute)) continue;
    if (normalizedRelative(realRoot, fs.realpathSync(absolute)) === null) continue;
    if (fs.lstatSync(absolute).isSymbolicLink()) continue;
    const candidates = source.directory ? collectMarkdownFiles(root, absolute) : [absolute];
    for (const candidate of candidates) {
      if (fs.lstatSync(candidate).isSymbolicLink() || !fs.statSync(candidate).isFile()) continue;
      const relativePath = normalizedRelative(root, candidate);
      if (relativePath === null || seen.has(relativePath)) continue;
      seen.add(relativePath);
      discovered.push({
        path: relativePath,
        category: source.category,
        priority: source.priority,
        bytes: fs.statSync(candidate).size,
        sha256: crypto.createHash("sha256").update(fs.readFileSync(candidate)).digest("hex")
      });
    }
  }

  return discovered
    .sort((a, b) => a.priority - b.priority || a.path.localeCompare(b.path))
    .slice(0, maxFiles);
}

function contextWarnings(files) {
  const paths = new Set(files.map((file) => file.path));
  const warnings = [];
  if (!paths.has("AGENTS.md")) warnings.push("AGENTS.md is missing; repository-specific agent rules are unavailable");
  if (!paths.has("docs/project/PLANS.md")) warnings.push("docs/project/PLANS.md is missing; project goals and roadmap are unavailable");
  return warnings;
}

function buildProjectContextBundle(project, options = {}) {
  const maxBytes = Number(options.maxBytes ?? DEFAULT_MAX_BYTES);
  if (!Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 1024 * 1024) {
    throw new Error("Context max bytes must be an integer between 1024 and 1048576");
  }
  const files = discoverProjectContext(project.path, options);
  const warnings = contextWarnings(files);
  const profile = options.profile || null;
  const prefix = [
    `PROJECT_ID: ${project.id}`,
    `PROJECT_PATH: ${project.path}`,
    `STACKS: ${(project.stacks || []).join(", ") || "unknown"}`,
    `BRANCH_AT_REGISTRATION: ${project.branch || "unknown"}`,
    `ONBOARDING_PROFILE: ${profile?.status || "MISSING"}`,
    `PROFILE_FINGERPRINT: ${profile?.content_fingerprint || "none"}`,
    `CONTEXT_WARNINGS: ${warnings.join(" | ") || "none"}`
  ].join("\n");
  const sections = [];
  const included = [];
  const omitted = [];
  let usedBytes = Buffer.byteLength(prefix, "utf8");

  for (const file of files) {
    const absolute = path.resolve(project.path, file.path);
    if (normalizedRelative(path.resolve(project.path), absolute) === null) {
      throw new Error(`Context file escaped project root: ${file.path}`);
    }
    if (fs.lstatSync(absolute).isSymbolicLink()
        || normalizedRelative(fs.realpathSync(project.path), fs.realpathSync(absolute)) === null) {
      throw new Error(`Context file escaped project root through a symbolic link: ${file.path}`);
    }
    const content = fs.readFileSync(absolute, "utf8").replace(/^\uFEFF/, "");
    const header = `\n---\nSOURCE: ${file.path}\nCATEGORY: ${file.category}\n---\n`;
    const sectionBytes = Buffer.byteLength(header + content, "utf8");
    if (usedBytes + sectionBytes > maxBytes) {
      omitted.push({ ...file, reason: "byte-limit" });
      continue;
    }
    sections.push(header + content);
    included.push(file);
    usedBytes += sectionBytes;
  }

  return {
    schema_version: "1.0",
    project_id: project.id,
    project_path: project.path,
    generated_at: new Date().toISOString(),
    max_bytes: maxBytes,
    bytes: usedBytes,
    truncated: omitted.length > 0,
    files: included,
    omitted,
    warnings,
    content: prefix + sections.join("")
  };
}

module.exports = {
  buildProjectContextBundle,
  contextWarnings,
  discoverProjectContext,
  normalizedRelative
};
