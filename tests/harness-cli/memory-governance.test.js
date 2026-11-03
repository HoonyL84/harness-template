"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  parseFrontmatter,
  validateMemoryContent,
  validateMemoryDirectory
} = require("../../tools/harness-cli/memory-governance");

const VALID_NOTE = `---
id: mem-2026-11-03-routing
layer: episodic
title: Task-aware model routing decision
owner: hoony
created_at: 2026-11-03
updated_at: 2026-11-03
tags: [routing, cost]
source: agent
---

# Summary
Selected 3-tier deterministic routing with retry escalation.
`;

test("validateMemoryContent accepts valid frontmatter and catches governance violations", () => {
  assert.deepEqual(validateMemoryContent(VALID_NOTE, "episodic"), []);
  assert.equal(parseFrontmatter("no frontmatter"), null);
  assert.match(validateMemoryContent("no frontmatter", "episodic").join(), /Missing YAML frontmatter/);
  assert.match(validateMemoryContent(VALID_NOTE, "semantic").join(), /does not match directory layer/);
  assert.match(validateMemoryContent(VALID_NOTE, "unknown").join(), /Unknown memory layer/);

  const badFields = `---
id: mem-1
layer: working
title: Test
owner: hoony
created_at: 2026/11/03
updated_at: bad-date
tags: not-brackets
source: external
---
`;
  const errors = validateMemoryContent(badFields, "working");
  assert.match(errors.join(), /Invalid created_at/);
  assert.match(errors.join(), /Invalid updated_at/);
  assert.match(errors.join(), /Invalid source/);
  assert.match(errors.join(), /bracketed list/);
});

test("validateMemoryDirectory scans memory layers, skips README/template, and rejects symlinks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "memory-gov-test-"));
  const episodicDir = path.join(root, "memory", "episodic");
  const workingDir = path.join(root, "memory", "working");
  fs.mkdirSync(episodicDir, { recursive: true });
  fs.mkdirSync(workingDir, { recursive: true });

  fs.writeFileSync(path.join(episodicDir, "README.md"), "# Ignored README\n");
  fs.writeFileSync(path.join(episodicDir, "2026-11-03_routing.md"), VALID_NOTE);

  const passReport = validateMemoryDirectory(root);
  assert.equal(passReport.ok, true);
  assert.equal(passReport.checked, 1);
  assert.equal(passReport.files[0].file, "memory/episodic/2026-11-03_routing.md");

  fs.writeFileSync(path.join(workingDir, "2026-11-03_broken.md"), "# Missing frontmatter\n");
  const failReport = validateMemoryDirectory(root);
  assert.equal(failReport.ok, false);
  assert.equal(failReport.checked, 2);

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "memory-outside-"));
  fs.mkdirSync(path.join(root, "memory", "semantic"), { recursive: true });
  fs.symlinkSync(outside, path.join(root, "memory", "procedural"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => validateMemoryDirectory(root), /symlink|junction/);
});
