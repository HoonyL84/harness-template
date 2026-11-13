"use strict";

const LOCAL_TASK_NAME_RE = /^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u;
const WINDOWS_RESERVED_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const TITLE_HEADINGS = ["제목", "Title"];
const SUMMARY_HEADINGS = ["내용 (무슨 일인가)", "내용", "Goal"];
const WHY_HEADINGS = ["원인 / 배경 (왜 하는가)", "원인 / 배경", "원인", "배경", "Why"];
const ACCEPTANCE_HEADINGS = ["완료 기준 (어떻게 확인하는가)", "완료 기준", "Acceptance Criteria", "Acceptance"];
const REVIEW_HEADINGS = ["운영 검수", "Operational Review"];

function normalizeTaskName(value) {
  return String(value || "").trim().normalize("NFC");
}

/** Allow readable Unicode/Korean hyphenated task names while rejecting escapes, spaces, and Windows device names. */
function isValidLocalTaskName(value) {
  if (typeof value !== "string") return false;
  const normalized = normalizeTaskName(value);
  if (!normalized || normalized.length > 120) return false;
  return LOCAL_TASK_NAME_RE.test(normalized) && !WINDOWS_RESERVED_RE.test(normalized);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractTicketSection(content, headings) {
  const text = String(content || "");
  for (const heading of headings) {
    const pattern = new RegExp(`^## ${escapeRegExp(heading)}\\s*\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "mi");
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return "";
}

function firstBulletLine(section) {
  for (const rawLine of String(section || "").split(/\r?\n/)) {
    const cleaned = rawLine.replace(/^\s*-\s*(?:\[[ xX]\]\s*)?/, "").trim();
    if (cleaned) return cleaned;
  }
  return "";
}

function extractTicketTitle(content, fallbackId = "") {
  const explicit = firstBulletLine(extractTicketSection(content, TITLE_HEADINGS));
  if (explicit) return explicit;
  const headingMatch = String(content || "").match(/^# (?:티켓|TICKET):\s*([^\r\n]+)/m);
  const heading = headingMatch?.[1]?.trim() || "";
  if (heading && heading.normalize("NFC") !== String(fallbackId || "").normalize("NFC")) return heading;
  return firstBulletLine(extractTicketSection(content, SUMMARY_HEADINGS)) || fallbackId;
}

function extractTicketCause(content) {
  return firstBulletLine(extractTicketSection(content, WHY_HEADINGS));
}

function parseAcceptanceProgress(content) {
  const section = extractTicketSection(content, ACCEPTANCE_HEADINGS);
  const pending = (section.match(/^- \[ \]/gm) || []).length;
  const checked = (section.match(/^- \[x\]/gim) || []).length;
  const review = extractTicketSection(content, REVIEW_HEADINGS);
  const remaining_conditions = [...review.matchAll(/^- \[ \] (.+)$/gm)].map((match) => match[1].trim());
  return { checked, pending, remaining_conditions };
}

function prefixProjectLabel(projectId, text) {
  const clean = String(text || "").trim();
  const id = String(projectId || "").trim();
  if (!id) return clean;
  const tag = `[${id}]`;
  const body = clean.startsWith(tag) ? clean.slice(tag.length).trim() : clean;
  return body ? `${tag} ${body}` : tag;
}

module.exports = {
  extractTicketCause,
  extractTicketSection,
  extractTicketTitle,
  isValidLocalTaskName,
  normalizeTaskName,
  parseAcceptanceProgress,
  prefixProjectLabel
};
