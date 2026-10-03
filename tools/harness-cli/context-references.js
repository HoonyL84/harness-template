"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const MAX_REFS = 10;
const DEFAULT_REMOTE_AGE_MINUTES = 1440;

/** Explicit references are required inputs, not permissions or semantic evidence. */
function normalizeContextRefs(value = []) {
  if (!Array.isArray(value) || value.length > MAX_REFS) throw new Error("context_refs must contain up to 10 references");
  const refs = value.map(ref => {
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) throw new Error("Invalid context reference");
    if (ref.path !== undefined) {
      if (Object.keys(ref).some(key => !["path", "section", "sha256"].includes(key))
          || typeof ref.path !== "string" || ref.path.length > 500 || (/[<>|"?*]/.test(ref.path) || [...ref.path].some(char => char.charCodeAt(0) < 32))
          || !(ref.path === "AGENTS.md" || ref.path === "README.md" || /^docs\/[^\\:]+\.md$/i.test(ref.path))
          || ref.path.split("/").some(segment => !segment || segment.startsWith(".") || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment) || ["node_modules", "vendor"].includes(segment.toLowerCase()))) throw new Error("Context path must be safe project-relative Markdown under docs/, AGENTS.md or README.md");
      if (ref.section !== undefined && (typeof ref.section !== "string" || !ref.section.trim() || ref.section.length > 200 || /[\r\n\0]/.test(ref.section))) throw new Error("Context section must be an exact heading up to 200 characters");
      if (ref.sha256 !== undefined && (typeof ref.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(ref.sha256))) throw new Error("Context sha256 must be lowercase SHA-256");
      return { path: ref.path, ...(ref.section !== undefined ? { section: ref.section.trim() } : {}), ...(ref.sha256 !== undefined ? { sha256: ref.sha256 } : {}) };
    }
    const age = ref.max_age_minutes ?? DEFAULT_REMOTE_AGE_MINUTES;
    if (Object.keys(ref).some(key => !["page_id", "version", "max_age_minutes"].includes(key)) || typeof ref.page_id !== "string" || !/^[1-9][0-9]*$/.test(ref.page_id)
        || !Number.isInteger(ref.version) || ref.version < 1 || !Number.isInteger(age) || age < 1 || age > DEFAULT_REMOTE_AGE_MINUTES) throw new Error("Confluence reference requires page_id, positive version and max_age_minutes between 1 and 1440");
    return { page_id: ref.page_id, version: ref.version, max_age_minutes: age };
  });
  const identities = refs.map(ref => ref.path ? "file:" + ref.path.toLowerCase() : "page:" + ref.page_id);
  if (new Set(identities).size !== refs.length) throw new Error("Duplicate context references; use one section or the whole document");
  return refs;
}

/** Reject every symlink/junction component before reading explicit documents. */
function readReferencedFile(root, ref) {
  const realRoot = fs.realpathSync(root);
  let current = realRoot;
  for (const part of ref.path.split("/")) {
    current = path.join(current, part);
    if (!fs.existsSync(current) || fs.lstatSync(current).isSymbolicLink()) throw new Error("Required context missing or symbolic link/junction: " + ref.path);
    const relative = path.relative(realRoot, fs.realpathSync(current));
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw new Error("Context escaped project root");
  }
  if (!fs.statSync(current).isFile() || fs.statSync(current).size > 1024 * 1024) throw new Error("Required context must be a regular file of at most 1MB: " + ref.path);
  const bytes = fs.readFileSync(current), sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (ref.sha256 && ref.sha256 !== sha256) throw new Error("Required context hash changed; revise and approve the ticket: " + ref.path);
  const content = bytes.toString("utf8").replace(/^\uFEFF/, "");
  if (content.includes("\0")) throw new Error("Required context must be text Markdown: " + ref.path);
  return { content, sha256, bytes: bytes.length };
}

/** ATX headings outside code fences; include nested headings until the next peer. */
function selectMarkdownSection(content, heading) {
  const lines = content.split(/\r?\n/), headings = [];
  let fence = null;
  lines.forEach((line, index) => {
    const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (delimiter) {
      if (!fence) fence = delimiter[1];
      else if (delimiter[1][0] === fence[0] && delimiter[1].length >= fence.length && /^ {0,3}[`~]+\s*$/.test(line)) fence = null;
      return;
    }
    if (fence) return;
    const match = line.match(/^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*$/);
    if (match) headings.push({ index, level: match[1].length, title: match[2].replace(/[ \t]+#+[ \t]*$/, "") });
  });
  const matches = headings.filter(item => item.title === heading);
  if (matches.length !== 1) throw new Error("Required context section missing or ambiguous: " + heading);
  const selected = matches[0], end = headings.find(item => item.index > selected.index && item.level <= selected.level)?.index ?? lines.length;
  return lines.slice(selected.index, end).join("\n");
}

function assertRemoteReferences(refs, remote, now = Date.now()) {
  if (!Number.isFinite(now)) throw new Error("Context time must be a finite timestamp");
  for (const ref of refs.filter(item => item.page_id)) {
    const page = remote?.pages?.find(item => item.id === ref.page_id);
    const fetched = Date.parse(remote?.fetched_at);
    if (!page || page.version !== ref.version || !Number.isFinite(fetched) || fetched > now || now - fetched > ref.max_age_minutes * 60000) {
      throw new Error("Required Confluence context missing, version mismatched or stale; run atlassian context to refresh, then review the ticket: " + ref.page_id);
    }
  }
}

module.exports = { assertRemoteReferences, normalizeContextRefs, readReferencedFile, selectMarkdownSection };
