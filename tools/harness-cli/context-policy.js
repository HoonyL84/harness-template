"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MODE_FILES = Object.freeze({
  standard: [],
  "auto-fix": ["auto-fix-policy.md"],
  l5: ["l5-autonomy-policy.md"],
  orchestrate: ["execution-modes.md", "l5-autonomy-policy.md", "agent-roles.md"]
});
const DETAIL_FILES = [...new Set(Object.values(MODE_FILES).flat())];

function modeFiles(mode = "standard") {
  if (!Object.hasOwn(MODE_FILES, mode)) throw new Error(`Unknown execution context mode: ${mode}`);
  return MODE_FILES[mode];
}

// An unknown stack keeps the reference profile. Never infer a stack from task prose.
function needsStackProfile(root, stacks) {
  const realRoot = fs.realpathSync(root);
  const profile = path.join(realRoot, "docs/design-docs/tech-stack.md");
  // A project's custom profile may describe Node/Python rules; never discard it by name.
  if (fs.existsSync(profile)) {
    for (let current = profile; current !== realRoot; current = path.dirname(current)) {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error("Stack profile symlink/junction rejected");
    }
    const stat = fs.statSync(profile);
    if (!stat.isFile() || stat.size > 1024 * 1024) throw new Error("Unsafe or oversized stack profile");
    if (!fs.readFileSync(profile, "utf8").startsWith("<!-- harness-profile: java-spring -->")) return true;
  }
  const has = file => fs.existsSync(path.join(root, file));
  if (["pom.xml", "build.gradle", "build.gradle.kts"].some(has)) return true;
  if (stacks?.length) return stacks.some(stack => !["node", "python", "go", "rust", "dotnet", "godot"].includes(stack));
  if (["package.json", "pyproject.toml", "requirements.txt", "go.mod", "Cargo.toml", "project.godot"].some(has)) return false;
  return true;
}

module.exports = { DETAIL_FILES, modeFiles, needsStackProfile };
