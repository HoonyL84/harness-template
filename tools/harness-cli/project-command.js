"use strict";

const path = require("node:path");
const { buildProjectContextBundle, contextWarnings, discoverProjectContext } = require("./project-context");
const {
  approveOnboardingProfile,
  createOnboardingProfile,
  readOnboardingProfile,
  writeOnboardingProfile
} = require("./project-onboarding");
const {
  inspectGitProject,
  readRegistry,
  removeProject,
  upsertProject,
  validateProjectId,
  writeRegistry
} = require("./project-registry");

function createProjectCommand({ root, parseArgs, runGit, log }) {
  const registryPath = path.join(root, ".harness", "local", "projects.json");
  const profilePath = (id) => path.join(root, ".harness", "local", "profiles", `${id}.json`);

  const diagnose = (project) => inspectGitProject(project.path, runGit);
  const print = (value, json) => log(json ? JSON.stringify(value, null, 2) : value);

  return function commandProject(args) {
    const { positional, options } = parseArgs(args);
    const [action, rawId] = positional;
    const registry = readRegistry(registryPath);

    if (action === "add") {
      const id = validateProjectId(rawId);
      if (!options.path || options.path === true) throw new Error("Usage: project add <id> --path <git-root>");
      const project = upsertProject(registry, id, inspectGitProject(options.path, runGit));
      writeRegistry(registryPath, registry);
      print(options.json ? project : `[REGISTERED] ${id} -> ${project.path}\n  stack: ${project.stacks.join(", ") || "unknown"}\n  branch: ${project.branch}\n  dirty: ${project.dirty ? `yes (${project.changed_paths} paths)` : "no"}`, options.json);
      return project;
    }

    if (action === "list") {
      const projects = Object.values(registry.projects).sort((a, b) => a.id.localeCompare(b.id));
      if (options.json) print(projects, true);
      else if (projects.length === 0) log("No projects registered.");
      else for (const project of projects) log(`${project.id}\t${project.path}\t${project.stacks.join(",") || "unknown"}`);
      return projects;
    }

    if (action === "show") {
      const id = validateProjectId(rawId);
      const project = registry.projects[id];
      if (!project) throw new Error(`Unknown project: ${id}`);
      print(project, true);
      return project;
    }

    if (action === "check") {
      const selected = rawId ? [registry.projects[validateProjectId(rawId)]] : Object.values(registry.projects);
      if (selected.some((project) => !project)) throw new Error(`Unknown project: ${rawId}`);
      const results = selected.map((project) => {
        try {
          return { id: project.id, ok: true, ...diagnose(project) };
        } catch (error) {
          return { id: project.id, ok: false, error: error.message };
        }
      });
      if (options.json) print(results, true);
      else for (const result of results) log(`${result.ok ? "[PASS]" : "[FAIL]"} ${result.id}${result.ok ? ` (${result.branch}, dirty=${result.dirty})` : `: ${result.error}`}`);
      if (results.some((result) => !result.ok)) {
        const error = new Error("One or more registered projects failed diagnostics");
        error.code = 1;
        throw error;
      }
      return results;
    }

    if (action === "context") {
      const id = validateProjectId(rawId);
      const project = registry.projects[id];
      if (!project) throw new Error(`Unknown project: ${id}`);
      const maxBytes = options["max-bytes"] === undefined ? undefined : Number(options["max-bytes"]);
      if (options.bundle) {
        const profile = readOnboardingProfile(profilePath(id));
        const bundle = buildProjectContextBundle(project, { maxBytes, profile });
        print(options.json ? bundle : bundle.content, options.json);
        return bundle;
      }
      const files = discoverProjectContext(project.path);
      const summary = {
        project_id: id,
        files,
        total_files: files.length,
        total_bytes: files.reduce((sum, file) => sum + file.bytes, 0),
        warnings: contextWarnings(files),
        onboarding_profile: readOnboardingProfile(profilePath(id))?.status || "MISSING"
      };
      if (options.json) print(summary, true);
      else {
        log(`[CONTEXT] ${id}: ${summary.total_files} files, ${summary.total_bytes} bytes`);
        for (const warning of summary.warnings) log(`[WARN] ${warning}`);
        for (const file of files) log(`${file.category}\t${file.path}\t${file.bytes} bytes`);
      }
      return summary;
    }

    if (action === "onboard") {
      const id = validateProjectId(rawId);
      const project = registry.projects[id];
      if (!project) throw new Error(`Unknown project: ${id}`);
      const diagnosis = inspectGitProject(project.path, runGit);
      const files = discoverProjectContext(project.path);
      const current = createOnboardingProfile(project, diagnosis, files, contextWarnings(files));
      const targetPath = profilePath(id);
      if (options.approve) {
        const approved = approveOnboardingProfile(readOnboardingProfile(targetPath), current);
        writeOnboardingProfile(targetPath, approved);
        print(options.json ? approved : `[APPROVED] ${id} onboarding profile ${approved.content_fingerprint.slice(0, 12)}`, options.json);
        return approved;
      }
      writeOnboardingProfile(targetPath, current);
      print(options.json ? current : `[DRAFT] ${id} onboarding profile generated\n  fingerprint: ${current.content_fingerprint}\n  context warnings: ${current.context.warnings.length}\n  dirty source tree: ${current.git.dirty}`, options.json);
      return current;
    }

    if (action === "profile") {
      const id = validateProjectId(rawId);
      if (!registry.projects[id]) throw new Error(`Unknown project: ${id}`);
      const profile = readOnboardingProfile(profilePath(id));
      if (!profile) throw new Error(`Onboarding profile is missing for project: ${id}`);
      print(profile, true);
      return profile;
    }

    if (action === "remove") {
      const removed = removeProject(registry, rawId);
      writeRegistry(registryPath, registry);
      log(`[REMOVED] ${removed.id} (project files were not changed)`);
      return removed;
    }

    throw new Error("Usage: project <add|list|show|check|context|onboard|profile|remove> [id] [--path <git-root>] [--bundle] [--approve] [--json]");
  };
}

module.exports = { createProjectCommand };
