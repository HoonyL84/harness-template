"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const TICKET_KINDS = Object.freeze(["development", "planning", "design"]);
const KIND_LABELS = Object.freeze({ development: "개발", planning: "기획", design: "기술 설계" });
const MAX_ARTIFACT_BYTES = 16000;
const REQUIRED_SECTIONS = Object.freeze(["Decisions", "Open Questions", "Acceptance Review"]);

/** Missing kinds remain development for existing approved plans. */
function normalizeTicketKind(value = "development") {
  if (!TICKET_KINDS.includes(value)) throw new Error("Ticket kind must be development, planning or design");
  return value;
}
function isArtifactTicket(ticket) { return normalizeTicketKind(ticket.ticket_kind) !== "development"; }

/** Restrict artifact-only work to explicitly approved Markdown documents. */
function normalizeDeliverables(value = [], kind = "development") {
  if (!Array.isArray(value) || value.length > 10) throw new Error("Ticket deliverables must be an array of up to 10 Markdown paths");
  const files = value.map(file => {
    if (typeof file !== "string" || !/^docs\/[a-zA-Z0-9_\-/]+\.md$/.test(file)
        || file.split("/").some(segment => !segment || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment) || segment === ".." || segment === "." || ["node_modules", "vendor", "scripts", "tools"].includes(segment.toLowerCase()))) {
      throw new Error("Deliverables must be safe docs/ Markdown paths");
    }
    return file;
  });
  if (new Set(files.map(file => file.toLowerCase())).size !== files.length) throw new Error("Duplicate ticket deliverables");
  if (kind !== "development" && files.length === 0) throw new Error("Planning/design tickets require explicit deliverables");
  return files;
}

function assertArtifactPaths(ticket, changedPaths) {
  const allowed = normalizeDeliverables(ticket.deliverables, normalizeTicketKind(ticket.ticket_kind));
  if (changedPaths.some(file => !allowed.includes(file))) {
    throw new Error("Artifact ticket changed unapproved files; code changes require a development ticket and Full verification");
  }
}

/** Check structure, not correctness; human review remains the acceptance oracle. */
function verifyArtifactTicket(ticket, runGit) {
  const kind = normalizeTicketKind(ticket.ticket_kind);
  if (!isArtifactTicket(ticket) || !ticket.base_commit || !ticket.acceptance_criteria?.length) throw new Error("Artifact verification requires approved deliverables, criteria and a base commit");
  const gitPaths = args => {
    const result = runGit(args, ticket.worktree);
    if (result.error || result.status !== 0) throw new Error("Cannot inspect artifact worktree changes");
    return String(result.stdout || "").split("\0").filter(Boolean);
  };
  const changed = [...new Set([...gitPaths(["diff", "--name-only", "-z", ticket.base_commit, "--"]), ...gitPaths(["ls-files", "--others", "--exclude-standard", "-z"])])];
  assertArtifactPaths(ticket, changed);
  const artifacts = readArtifactDocuments(ticket);
  return { mode: "artifact", summary: "Artifact structure checked; semantic acceptance requires user review", results: [], artifacts,
    acceptance_checklist: ticket.acceptance_criteria.map(criterion => ({ criterion, status: "pending-user-review" })) };
}

function readArtifactDocuments(ticket) {
  const kind = normalizeTicketKind(ticket.ticket_kind);
  const root = fs.realpathSync(ticket.worktree);
  let totalBytes = 0;
  const artifacts = normalizeDeliverables(ticket.deliverables, kind).map(file => {
    let current = root;
    for (const segment of file.split("/")) {
      current = path.join(current, segment);
      if (!fs.existsSync(current) || fs.lstatSync(current).isSymbolicLink()) throw new Error("Artifact is missing or uses a symbolic link/junction: " + file);
      const relative = path.relative(root, fs.realpathSync(current));
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Artifact escaped the worktree");
    }
    if (!fs.statSync(current).isFile()) throw new Error("Artifact must be a regular file: " + file);
    totalBytes += fs.statSync(current).size;
    if (totalBytes > MAX_ARTIFACT_BYTES) throw new Error("Ticket artifacts exceed the 16KB publication budget");
    const content = fs.readFileSync(current, "utf8");
    if (content.includes("\0")) throw new Error("Artifact must be text Markdown");
    for (const section of REQUIRED_SECTIONS) {
      const body = content.match(new RegExp("^## " + section + "[ \\t]*\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))", "m"))?.[1];
      if (!body?.trim()) throw new Error("Artifact requires nonempty section: " + section);
    }
    return { path: file, sha256: crypto.createHash("sha256").update(content).digest("hex"), bytes: fs.statSync(current).size, content };
  });
  for (const criterion of ticket.acceptance_criteria) {
    if (!artifacts.some(artifact => artifact.content.match(/^## Acceptance Review[ \t]*\r?\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1]?.includes(criterion))) throw new Error("Artifact acceptance checklist is missing a criterion: " + criterion);
  }
  return artifacts;
}

/** Reject altered stored snapshots as well as changed source documents. */
function assertArtifactEvidence(ticket) {
  if (!isArtifactTicket(ticket) || ticket.verification?.mode !== "artifact"
      || JSON.stringify(readArtifactDocuments(ticket)) !== JSON.stringify(ticket.verification.artifacts)) {
    throw new Error("Artifact evidence changed; verify again before review or publication");
  }
  return true;
}

module.exports = { KIND_LABELS, TICKET_KINDS, assertArtifactEvidence, assertArtifactPaths, isArtifactTicket, normalizeDeliverables, normalizeTicketKind, verifyArtifactTicket };
