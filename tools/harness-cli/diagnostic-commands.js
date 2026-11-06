"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const { runAutonomySoak } = require("./autonomy-utils");

/** Diagnostics share production validators and transport; they do not own runtime state. */
function createDiagnosticCommands({ ROOT, parseArgs, fail, log, validateAutoFixPatch, validateL5Patch, renderPrompt, readText, VALID_ROLES, postJson, assessRecovery, getProviderRequestCount, setProviderRequestCount }) {
  function commandValidateAutoFix(args) {
    const { positional } = parseArgs(args);
    const [patchFile] = positional;
    if (!patchFile) {
      fail("Usage: node tools/harness-cli/index.js validate-auto-fix <patch-file>");
    }

    const patchPath = path.resolve(ROOT, patchFile);
    if (!patchPath.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(patchPath)) {
      fail(`Patch file not found inside repository: ${patchFile}`);
    }

    const patch = fs.readFileSync(patchPath, "utf8");
    const changedFiles = validateAutoFixPatch(patch);
    log(`Auto-fix patch policy passed: ${changedFiles.join(", ")}`);
  }

  function commandValidateL5Patch(args) {
    const { positional } = parseArgs(args);
    const [patchFile] = positional;
    if (!patchFile) fail("Usage: node tools/harness-cli/index.js validate-l5-patch <patch-file>");
    const patchPath = path.resolve(ROOT, patchFile);
    if (!patchPath.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(patchPath)) {
      fail(`Patch file not found inside repository: ${patchFile}`);
    }
    const result = validateL5Patch(fs.readFileSync(patchPath, "utf8"));
    log(`L5 patch policy passed: ${result.paths.join(", ")}`);
    if (result.highRisk.length > 0) log(`Approval required: ${result.highRisk.join(", ")}`);
  }

  function commandValidatePrompts() {
    renderPrompt("prompts/templates/agent-system.md", {
      CONTEXT: "context",
      ROLE: "implementer",
      ROLE_PROMPT: "role prompt",
      TYPE: "code",
    });
    renderPrompt("prompts/templates/l5-planner.md");
    renderPrompt("prompts/templates/l5-implementer.md", { TICKET: "example-ticket" });
    for (const role of VALID_ROLES) {
      if (!readText(`prompts/system/roles/${role}.md`).trim()) {
        fail(`Role prompt is missing or empty: ${role}`);
      }
    }
    log("Prompt templates passed.");
  }

  async function commandValidateApiRetry() {
    const previous = {
      maxRetries: process.env.HARNESS_API_MAX_RETRIES,
      baseDelay: process.env.HARNESS_API_RETRY_BASE_MS,
      maxDelay: process.env.HARNESS_API_RETRY_MAX_MS,
      maxRequests: process.env.HARNESS_MAX_PROVIDER_REQUESTS,
      requestCount: getProviderRequestCount(),
    };
    process.env.HARNESS_API_MAX_RETRIES = "2";
    process.env.HARNESS_API_RETRY_BASE_MS = "1";
    process.env.HARNESS_API_RETRY_MAX_MS = "5";
    process.env.HARNESS_MAX_PROVIDER_REQUESTS = "10";
    setProviderRequestCount(0);

    let retryRequests = 0;
    let quotaRequests = 0;
    const server = http.createServer((req, res) => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/retry") {
        retryRequests += 1;
        if (retryRequests === 1) {
          res.statusCode = 503;
          res.setHeader("Retry-After", "0");
          res.end(JSON.stringify({ error: { code: "temporary_unavailable" } }));
        } else {
          res.statusCode = 200;
          res.end(JSON.stringify({ ok: true }));
        }
        return;
      }
      quotaRequests += 1;
      res.statusCode = 429;
      res.end(JSON.stringify({ error: { code: "insufficient_quota" } }));
    });

    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const { port } = server.address();
      const retried = await postJson(`http://127.0.0.1:${port}/retry`, {}, { test: true });
      if (!retried.ok || retryRequests !== 2) fail("API retry self-test did not retry exactly once.");
      let quotaFailed = false;
      try {
        await postJson(`http://127.0.0.1:${port}/quota`, {}, { test: true });
      } catch (err) {
        quotaFailed = err.message.includes("insufficient_quota");
      }
      if (!quotaFailed || quotaRequests !== 1) fail("API quota self-test retried a non-retryable quota error.");
      log("API retry policy passed.");
    } finally {
      await new Promise((resolve) => {
        server.close(resolve);
      });
      const restore = (key, value) => {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      };
      restore("HARNESS_API_MAX_RETRIES", previous.maxRetries);
      restore("HARNESS_API_RETRY_BASE_MS", previous.baseDelay);
      restore("HARNESS_API_RETRY_MAX_MS", previous.maxDelay);
      restore("HARNESS_MAX_PROVIDER_REQUESTS", previous.maxRequests);
      setProviderRequestCount(previous.requestCount);
    }
  }

  function commandValidateRecovery() {
    const base = {
      state: { status: "implementing", current_ticket: "demo" },
      active: ["demo"],
      dirty: [".harness/tasks/active/demo.md"],
      headSha: "abc",
      verify: {},
      contentFingerprint: "current",
      patchExists: false,
    };
    const cases = [
      [base, "retry_agent"],
      [{ ...base, dirty: [...base.dirty, "src/demo.js"] }, "inspect_and_verify"],
      [{ ...base, verify: { last_full: { result: "pass", content_fingerprint: "old" } } }, "reverify_required"],
      [{ ...base, verify: { last_full: { result: "pass", content_fingerprint: "current" } } }, "ready_to_complete"],
      [{ ...base, verify: { last_full: { result: "fail", reason: "test failed" } } }, "fix_and_reverify"],
      [{
        ...base,
        state: {
          status: "applying_patch",
          current_ticket: "demo",
          recovery_checkpoint: { head_sha: "abc", working_tree: base.dirty },
        },
        patchExists: true,
      }, "retry_patch"],
      [{ ...base, active: ["demo", "other"] }, "manual_review"],
    ];
    for (const [input, expected] of cases) {
      const actual = assessRecovery(input).action;
      if (actual !== expected) fail(`Recovery self-test expected ${expected} but received ${actual}.`);
    }
    log("Recovery diagnostics policy passed.");
  }

  function commandValidateL5Soak(args) {
    const { options } = parseArgs(args);
    const cycles = Number(options.cycles || "1000");
    if (!Number.isInteger(cycles) || cycles < 1 || cycles > 100000) {
      fail("--cycles must be an integer between 1 and 100000.");
    }
    const result = runAutonomySoak(cycles);
    log(`L5 autonomy soak simulation passed: cycles=${result.cycles}, scenarios=${result.scenarios}.`);
  }

  return { commandValidateAutoFix, commandValidateL5Patch, commandValidatePrompts, commandValidateApiRetry, commandValidateRecovery, commandValidateL5Soak };
}

module.exports = { createDiagnosticCommands };
