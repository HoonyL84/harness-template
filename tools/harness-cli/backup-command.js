"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { writeJsonAtomic, updateJsonLocked } = require("./control-plane-state");
const { appendHistory, collectHistory } = require("./work-history");
const { validateProjectId } = require("./project-registry");

const ROOTS = [".harness/local", ".harness/tasks", "observability/metrics", "observability/provider-usage"];
const MAX_BYTES = 16 * 1024 * 1024;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 1000;
const TTL = 10 * 60 * 1000;
const hash = value => crypto.createHash("sha256").update(value).digest("hex");
const uuid = value => typeof value === "string" && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);

function safeRelative(name) {
  if (typeof name !== "string" || name.includes("\\") || name.split("/").some(part =>
    !part || part === "." || part === ".." || /[<>:"|?*]/.test(part) || [...part].some(char => char.charCodeAt(0) < 32)
    || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
    throw new Error("Unsafe backup path");
  }
  if (!ROOTS.some(root => name.startsWith(`${root}/`)) || excluded(name)) throw new Error("Backup path is not allowed");
  return name;
}

function excluded(name) {
  return /(^|\/)(restored|backup-previews)(\/|$)/.test(name)
    || /(^|\/)(\.env[^/]*|[^/]*(?:secret|credential|password|api[-_]?key|api[-_]?token)[^/]*)(\/|$)/i.test(name)
    || /\.(tmp|lock)(?:-|$)/.test(name) || /\.harbackup\.json$/.test(name);
}

function containsSecret(value) {
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key, item]) => /^(api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|password|secret|authorization|credentials)$/i.test(key)
    || containsSecret(item));
}

// Check every existing ancestor, not only the final file (Windows junctions included).
function noLinks(file) {
  const absolute = path.resolve(file);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) || (() => { try { fs.lstatSync(current); return true; } catch { return false; } })()) {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Backup paths cannot use symlinks or junctions");
    }
  }
  return absolute;
}

function passphrase(env) {
  const value = env.HARNESS_BACKUP_PASSPHRASE;
  if (typeof value !== "string" || value.length < 16 || value.length > 1024) {
    throw new Error("Set HARNESS_BACKUP_PASSPHRASE locally (16-1024 characters); never pass it on the command line");
  }
  return value;
}

function inventory(root) {
  const files = [];
  const visit = name => {
    const file = noLinks(path.join(root, name));
    if (!fs.existsSync(file)) return;
    if (name.endsWith(".lock")) throw new Error("Stop managed operations before backup: active lock found");
    if (excluded(name)) return;
    const stat = fs.lstatSync(file);
    if (stat.isDirectory()) {
      for (const child of fs.readdirSync(file).sort()) visit(`${name}/${child}`);
    } else if (stat.isFile()) {
      safeRelative(name);
      if (stat.size > MAX_FILE_BYTES || files.length >= MAX_FILES) throw new Error("Backup file limit exceeded");
      files.push(name);
    } else throw new Error("Backup only supports regular files");
  };
  ROOTS.forEach(visit);
  return files;
}

function createSnapshot(root, now = Date.now()) {
  noLinks(root);
  const names = inventory(root);
  const entries = [], skipped = [], observed = new Map();
  let size = 0;
  for (const name of names) {
    const bytes = fs.readFileSync(noLinks(path.join(root, name)));
    const sha256 = hash(bytes);
    observed.set(name, sha256);
    if (bytes.length > MAX_FILE_BYTES || (size += bytes.length) > MAX_BYTES) throw new Error("Backup byte limit exceeded");
    if (name.endsWith(".json")) {
      const value = JSON.parse(bytes.toString("utf8"));
      if (name.startsWith(".harness/local/executions/") && value.tickets?.some(ticket => ["RUNNING", "VERIFYING"].includes(ticket.status))) {
        throw new Error("Stop or reconcile running execution before backup");
      }
      if (containsSecret(value)) { skipped.push(name); continue; }
    }
    entries.push({ path: name, sha256, data: bytes.toString("base64") });
  }
  const history = collectHistory(root).filter(event => !containsSecret(event));
  // Normal writers do not share a snapshot transaction; detect observable changes and fail closed.
  if (JSON.stringify(names) !== JSON.stringify(inventory(root)) || names.some(name =>
    hash(fs.readFileSync(noLinks(path.join(root, name)))) !== observed.get(name))) throw new Error("State changed during backup; stop operations and retry");
  return { schema_version: "1.0", id: crypto.randomUUID(), created_at: new Date(now).toISOString(), entries, history, skipped };
}

function encodeSnapshot(snapshot, password) {
  const bytes = Buffer.from(JSON.stringify(snapshot));
  if (bytes.length > MAX_BYTES) throw new Error("Backup byte limit exceeded");
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", crypto.scryptSync(password, salt, 32), iv);
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return JSON.stringify({ format: "harness-evidence-backup-v1", salt: salt.toString("base64"), iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") });
}

function base64(value, length) {
  if (typeof value !== "string" || !value.length || Buffer.from(value, "base64").toString("base64") !== value) throw new Error("Invalid backup encoding");
  const bytes = Buffer.from(value, "base64");
  if (length && bytes.length !== length) throw new Error("Invalid backup encoding length");
  return bytes;
}

function validateSnapshot(snapshot) {
  if (snapshot.schema_version !== "1.0" || !uuid(snapshot.id) || !Number.isFinite(Date.parse(snapshot.created_at))
    || !Array.isArray(snapshot.entries) || snapshot.entries.length > MAX_FILES || !Array.isArray(snapshot.history)
    || snapshot.history.length > 20000 || !Array.isArray(snapshot.skipped)) throw new Error("Invalid backup snapshot");
  const paths = new Set();
  let size = 0;
  for (const entry of snapshot.entries) {
    const name = safeRelative(entry.path);
    const bytes = entry.data === "" ? Buffer.alloc(0) : base64(entry.data);
    if (paths.has(name.toLowerCase()) || bytes.length > MAX_FILE_BYTES || (size += bytes.length) > MAX_BYTES
      || hash(bytes) !== entry.sha256) throw new Error("Invalid backup entry or content hash");
    paths.add(name.toLowerCase());
    if (name.endsWith(".json") && containsSecret(JSON.parse(bytes.toString("utf8")))) throw new Error("Secret-bearing backup entry refused");
  }
  for (const event of snapshot.history) {
    validateProjectId(event.project_id); validateProjectId(event.ticket_id);
    if (typeof event.kind !== "string" || !/^[A-Z_]{1,80}$/.test(event.kind) || containsSecret(event)) throw new Error("Invalid backup history");
  }
  return snapshot;
}

function readSnapshot(file, password) {
  const absolute = noLinks(file);
  if (!fs.statSync(absolute).isFile() || fs.statSync(absolute).size > MAX_BYTES * 2) throw new Error("Backup envelope limit exceeded");
  const raw = fs.readFileSync(absolute);
  const envelope = JSON.parse(raw.toString("utf8"));
  if (envelope.format !== "harness-evidence-backup-v1") throw new Error("Unsupported backup format");
  let plaintext;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", crypto.scryptSync(password, base64(envelope.salt, 16), 32), base64(envelope.iv, 12));
    decipher.setAuthTag(base64(envelope.tag, 16));
    plaintext = Buffer.concat([decipher.update(base64(envelope.ciphertext)), decipher.final()]);
  } catch { throw new Error("Backup authentication failed (wrong passphrase or damaged archive)"); }
  if (plaintext.length > MAX_BYTES) throw new Error("Backup byte limit exceeded");
  return { snapshot: validateSnapshot(JSON.parse(plaintext.toString("utf8"))), archive_hash: hash(raw), file: absolute };
}

function createBackupCommand({ root, parseArgs, log = message => process.stdout.write(`${message}\n`), env = process.env, now = Date.now }) {
  return function commandBackup(args) {
    const { positional, options } = parseArgs(args);
    const action = positional[0];
    if (!["create", "inspect", "restore"].includes(action)) throw new Error("Use backup create | inspect --file <archive> | restore --file <archive> [--approve <preview-id>]");
    const password = passphrase(env);
    if (action === "create") {
      const snapshot = createSnapshot(root, now());
      const output = noLinks(options.output || path.join(root, ".harness", "backups", `${snapshot.id}.harbackup.json`));
      const data = encodeSnapshot(snapshot, password);
      fs.mkdirSync(path.dirname(output), { recursive: true });
      noLinks(output);
      fs.writeFileSync(output, data, { flag: "wx", mode: 0o600 });
      const result = { file: output, backup_id: snapshot.id, files: snapshot.entries.length, history_events: snapshot.history.length, skipped: snapshot.skipped };
      log(JSON.stringify(result, null, 2)); return result;
    }
    if (typeof options.file !== "string") throw new Error("--file <archive> is required");
    const loaded = readSnapshot(options.file, password);
    const { snapshot } = loaded;
    const summary = { backup_id: snapshot.id, created_at: snapshot.created_at, files: snapshot.entries.length,
      history_events: snapshot.history.length, skipped: snapshot.skipped, live_state_restored: false };
    if (action === "inspect") { log(JSON.stringify(summary, null, 2)); return summary; }
    const destination = path.join(root, ".harness", "local", "restored", snapshot.id);
    const previewDir = noLinks(path.join(root, ".harness", "local", "backup-previews"));
    if (!options.approve) {
      const id = crypto.randomUUID();
      noLinks(destination);
      if (fs.existsSync(destination)) throw new Error("This backup is already restored; destination exists");
      const preview = { id, root: fs.realpathSync(root), file: loaded.file, archive_hash: loaded.archive_hash,
        backup_id: snapshot.id, expires_at: now() + TTL, status: "PENDING" };
      writeJsonAtomic(path.join(previewDir, `${id}.json`), preview);
      const result = { ...summary, preview_id: id, destination, expires_in_minutes: 10 };
      log(JSON.stringify(result, null, 2)); return result;
    }
    if (!uuid(options.approve)) throw new Error("Invalid backup preview ID");
    const previewFile = noLinks(path.join(previewDir, `${options.approve}.json`));
    noLinks(`${previewFile}.lock`);
    updateJsonLocked(previewFile, null, preview => {
      if (!preview || preview.id !== options.approve || preview.status !== "PENDING" || preview.root !== fs.realpathSync(root)
        || preview.file !== loaded.file || preview.archive_hash !== loaded.archive_hash || preview.backup_id !== snapshot.id
        || !Number.isFinite(preview.expires_at) || preview.expires_at <= now() || preview.expires_at > now() + TTL) throw new Error("Backup preview is stale, changed, expired, or already used");
      noLinks(destination);
      if (fs.existsSync(destination)) throw new Error("Restore destination already exists");
      return { ...preview, status: "USED", used_at: new Date(now()).toISOString() };
    });
    // Restore evidence only. Never copy old approvals, leases, requests or outboxes into live state.
    fs.mkdirSync(noLinks(path.dirname(destination)), { recursive: true });
    fs.mkdirSync(noLinks(destination));
    for (const entry of snapshot.entries) {
      const output = noLinks(path.join(destination, safeRelative(entry.path)));
      fs.mkdirSync(path.dirname(output), { recursive: true });
      noLinks(output);
      fs.writeFileSync(output, Buffer.from(entry.data, "base64"), { flag: "wx", mode: 0o600 });
    }
    writeJsonAtomic(path.join(destination, "snapshot.json"), snapshot);
    noLinks(path.join(root, ".harness", "local", "history", "ledger.json"));
    noLinks(path.join(root, ".harness", "local", "history", "ledger.json.lock"));
    for (const event of snapshot.history) {
      appendHistory(root, { ...event, event_id: undefined, kind: event.kind.startsWith("RESTORED_") ? event.kind : `RESTORED_${event.kind}`,
        restored_evidence: true, backup_id: snapshot.id });
    }
    const result = { ...summary, destination, restored: true, notice: "Evidence only; register projects and obtain fresh approvals before execution or release" };
    log(JSON.stringify(result, null, 2)); return result;
  };
}

module.exports = { createBackupCommand, createSnapshot, encodeSnapshot, readSnapshot, validateSnapshot };
