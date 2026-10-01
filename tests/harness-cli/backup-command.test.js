"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { canonicalSystemPath, createBackupCommand, createSnapshot, encodeSnapshot, readSnapshot, validateSnapshot } = require("../../tools/harness-cli/backup-command");
const { appendHistory, collectHistory, requireAcceptedReview } = require("../../tools/harness-cli/work-history");

const PASSWORD = "fixture-only-backup-passphrase";
const clone = value => JSON.parse(JSON.stringify(value));

test("backup canonicalizes verified macOS system aliases without resolving nested user links", () => {
  const realpath = alias => `/private${alias}`;
  assert.equal(canonicalSystemPath("/var/folders/fixture", "darwin", realpath), "/private/var/folders/fixture");
  assert.equal(canonicalSystemPath("/tmp/archive.json", "darwin", realpath), "/private/tmp/archive.json");
  assert.equal(canonicalSystemPath("/etc/fixture", "darwin", realpath), "/private/etc/fixture");
  assert.equal(canonicalSystemPath("/var", "darwin", realpath), "/private/var");
  assert.equal(canonicalSystemPath("/var/user-link/archive.json", "darwin", realpath), "/private/var/user-link/archive.json");
});

test("backup system alias normalization cannot whitelist arbitrary symlinks or unexpected targets", () => {
  let calls = 0;
  const unexpected = () => { calls += 1; return "/attacker-controlled"; };
  assert.equal(canonicalSystemPath("/var/folders/fixture", "darwin", unexpected), "/var/folders/fixture");
  assert.equal(calls, 1);
  assert.equal(canonicalSystemPath("/various/fixture", "darwin", unexpected), "/various/fixture");
  assert.equal(canonicalSystemPath("/Users/user-link/fixture", "darwin", unexpected), "/Users/user-link/fixture");
  assert.equal(canonicalSystemPath("/var/fixture", "linux", unexpected), "/var/fixture");
  assert.equal(canonicalSystemPath("C:\\Temp\\fixture", "win32", unexpected), "C:\\Temp\\fixture");
  assert.equal(calls, 1);
});
function parseArgs(args) {
  const positional = [], options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (!args[index].startsWith("--")) positional.push(args[index]);
    else options[args[index].slice(2)] = args[index + 1] && !args[index + 1].startsWith("--") ? args[++index] : true;
  }
  return { positional, options };
}
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "harness-backup-"));
  const write = (name, value) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value)); return file;
  };
  write(".harness/local/projects.json", { projects: {} });
  write(".harness/tasks/archive/feature.md", "## Goal\n- preserved task evidence\n");
  const command = (extra = {}) => createBackupCommand({ root, parseArgs, log: () => {}, env: { HARNESS_BACKUP_PASSPHRASE: PASSWORD }, ...extra });
  return { root, write, command };
}

test("encrypted backup round trip preserves searchable evidence without replaying approvals", () => {
  const source = fixture(), target = fixture();
  source.write(".harness/local/releases/approval.json", { status: "APPROVED", id: "old" });
  appendHistory(source.root, { project_id: "demo", ticket_id: "feature", request_id: "request", kind: "USER_REVIEW",
    status: "accepted", fingerprint: "old-state", title: "Payment idempotency", timestamp: "2026-10-01T00:00:00Z" });
  const created = source.command()(["create"]);
  assert.ok(created.files >= 3);
  assert.ok(created.history_events >= 2);
  const encrypted = fs.readFileSync(created.file, "utf8");
  assert.doesNotMatch(encrypted, /Payment idempotency|old-state|preserved task evidence/);
  const inspect = target.command()(["inspect", "--file", created.file]);
  assert.equal(inspect.live_state_restored, false);
  const preview = target.command()(["restore", "--file", created.file]);
  assert.equal(fs.existsSync(preview.destination), false);
  assert.equal(fs.existsSync(path.join(target.root, ".harness/local/releases/approval.json")), false);
  const result = target.command()(["restore", "--file", created.file, "--approve", preview.preview_id]);
  assert.equal(result.restored, true);
  assert.ok(fs.existsSync(path.join(result.destination, ".harness/local/releases/approval.json")));
  assert.equal(fs.existsSync(path.join(target.root, ".harness/local/releases/approval.json")), false);
  const events = collectHistory(target.root);
  assert.ok(events.some(event => event.kind === "RESTORED_USER_REVIEW" && event.title === "Payment idempotency"));
  assert.throws(() => requireAcceptedReview(target.root, "request", { project_id: "demo", ticket_id: "feature" }, ["old-state"]), /accepted user review/);
  assert.throws(() => target.command()(["restore", "--file", created.file, "--approve", preview.preview_id]), /already used/);
  assert.throws(() => target.command()(["restore", "--file", created.file]), /already restored/);
});

test("backup excludes credentials, temporary files, archives and previous restored snapshots", () => {
  const f = fixture();
  f.write(".env.local", "ROOT_SECRET=do-not-copy");
  f.write(".harness/local/.env.local", "SECRET=do-not-copy");
  f.write(".harness/local/api-token.json", { value: "do-not-copy" });
  f.write(".harness/local/settings.json", { nested: { api_key: "do-not-copy" } });
  f.write(".harness/local/empty.txt", "");
  f.write(".harness/local/state.json.tmp-123", "incomplete");
  f.write(".harness/local/restored/old/old.json", {});
  f.write(".harness/local/backup-previews/old.json", {});
  f.write(".harness/local/old.harbackup.json", "old-backup");
  const snapshot = createSnapshot(f.root);
  assert.deepEqual(snapshot.skipped, [".harness/local/settings.json"]);
  assert.equal(snapshot.entries.length, 3);
  assert.ok(snapshot.entries.some(entry => entry.path.endsWith("empty.txt") && entry.data === ""));
  assert.equal(validateSnapshot(snapshot), snapshot);
  assert.doesNotMatch(JSON.stringify(snapshot), /do-not-copy/);
});

test("backup authentication rejects wrong passphrases, tampering and malformed envelopes", () => {
  const f = fixture(), created = f.command()(["create"]);
  assert.throws(() => readSnapshot(created.file, "wrong-password"), /authentication failed/);
  const envelope = JSON.parse(fs.readFileSync(created.file));
  const ciphertext = Buffer.from(envelope.ciphertext, "base64"); ciphertext[0] ^= 1;
  envelope.ciphertext = ciphertext.toString("base64");
  fs.writeFileSync(created.file, JSON.stringify(envelope));
  assert.throws(() => readSnapshot(created.file, PASSWORD), /authentication failed/);
  envelope.ciphertext = "not base64"; fs.writeFileSync(created.file, JSON.stringify(envelope));
  assert.throws(() => readSnapshot(created.file, PASSWORD), /authentication failed/);
  envelope.format = "unknown"; fs.writeFileSync(created.file, JSON.stringify(envelope));
  assert.throws(() => readSnapshot(created.file, PASSWORD), /Unsupported/);
  assert.throws(() => f.command({ env: {} })(["create"]), /HARNESS_BACKUP_PASSPHRASE/);
  assert.throws(() => f.command()(["unknown"]), /Use backup/);
  assert.throws(() => f.command()(["inspect"]), /--file/);
});

test("backup refuses overwrites, locks, running executions and oversized inputs", () => {
  const f = fixture(), created = f.command()(["create"]);
  assert.throws(() => f.command()(["create", "--output", created.file]), /EEXIST/);
  const lock = f.write(".harness/local/write.json.lock", {});
  assert.throws(() => createSnapshot(f.root), /active lock/); fs.unlinkSync(lock);
  const running = f.write(".harness/local/executions/demo.json", { tickets: [{ status: "RUNNING" }] });
  assert.throws(() => createSnapshot(f.root), /running execution/); fs.unlinkSync(running);
  f.write(".harness/local/big.bin", "x".repeat(4 * 1024 * 1024 + 1));
  assert.throws(() => createSnapshot(f.root), /file limit/);
  assert.throws(() => readSnapshot(f.root, PASSWORD), /envelope limit/);
});

test("backup snapshot validation rejects traversal, aliases, corrupt hashes and unsafe history", () => {
  const f = fixture(), original = createSnapshot(f.root);
  for (const name of ["../outside", ".harness/local/../../outside", ".harness/local/a\\b", "C:/outside",
    ".harness/local/CON.txt", ".harness/local/a:stream", ".harness/local/a.", ".harness/local/.env.local", "src/main.js"]) {
    const snapshot = clone(original); snapshot.entries[0].path = name;
    assert.throws(() => validateSnapshot(snapshot), /backup path/i);
  }
  const duplicate = clone(original); duplicate.entries.push({ ...duplicate.entries[0], path: duplicate.entries[0].path.toUpperCase().replace(".HARNESS/LOCAL", ".harness/local") });
  assert.throws(() => validateSnapshot(duplicate), /content hash/);
  const corrupt = clone(original); corrupt.entries[0].sha256 = "wrong";
  assert.throws(() => validateSnapshot(corrupt), /content hash/);
  const secret = clone(original);
  const bytes = Buffer.from('{"password":"hidden"}');
  secret.entries[0] = { path: ".harness/local/data.json", data: bytes.toString("base64"), sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  assert.throws(() => validateSnapshot(secret), /Secret-bearing/);
  const history = clone(original); history.history = [{ project_id: "demo", ticket_id: "feature", kind: "bad" }];
  assert.throws(() => validateSnapshot(history), /Invalid backup history/);
  assert.throws(() => validateSnapshot({}), /Invalid backup snapshot/);
});

test("restore approval is bound to unchanged encrypted bytes, target and ten-minute TTL", () => {
  const source = fixture(), target = fixture();
  const created = source.command()(["create"]);
  let time = Date.now();
  const command = target.command({ now: () => time });
  let preview = command(["restore", "--file", created.file]);
  assert.throws(() => command(["restore", "--file", created.file, "--approve", "invalid"]), /Invalid backup preview/);
  time += 600001;
  assert.throws(() => command(["restore", "--file", created.file, "--approve", preview.preview_id]), /expired/);
  preview = command(["restore", "--file", created.file]);
  const snapshot = readSnapshot(created.file, PASSWORD).snapshot;
  fs.writeFileSync(created.file, encodeSnapshot(snapshot, PASSWORD));
  assert.throws(() => command(["restore", "--file", created.file, "--approve", preview.preview_id]), /changed/);
  assert.equal(fs.existsSync(preview.destination), false);
});

test("backup and restore reject source and target junctions", () => {
  const source = fixture(), target = fixture(), outside = fixture();
  const created = source.command()(["create"]);
  fs.symlinkSync(outside.root, path.join(source.root, ".harness/local/escape"), "junction");
  assert.throws(() => createSnapshot(source.root), /symlinks or junctions/);
  fs.symlinkSync(outside.root, path.join(target.root, ".harness/local/restored"), "junction");
  assert.throws(() => target.command()(["restore", "--file", created.file]), /symlinks or junctions/);
  const linked = path.join(target.root, "link"); fs.symlinkSync(outside.root, linked, "junction");
  assert.throws(() => target.command()(["create", "--output", path.join(linked, "export.json")]), /symlinks or junctions/);
  assert.throws(() => createSnapshot(linked), /symlinks or junctions/);
});

test("partial restore consumes approval before effects and never removes existing files", () => {
  const source = fixture(), target = fixture();
  const created = source.command()(["create"]);
  const preview = target.command()(["restore", "--file", created.file]);
  fs.mkdirSync(path.join(target.root, ".harness/local/history"));
  fs.writeFileSync(path.join(target.root, ".harness/local/history/ledger.json"), "broken");
  assert.throws(() => target.command()(["restore", "--file", created.file, "--approve", preview.preview_id]), /invalid JSON/);
  assert.ok(fs.existsSync(preview.destination));
  assert.equal(fs.readFileSync(path.join(target.root, ".harness/local/history/ledger.json"), "utf8"), "broken");
  assert.throws(() => target.command()(["restore", "--file", created.file, "--approve", preview.preview_id]), /already used/);
});
