"use strict";

function createAgentApiCommands({
  ROOT,
  VALID_ROLES,
  parseEnvFile,
  parseArgs,
  applyExplicitTaskOption,
  resolveTaskId,
  fail,
  log,
  exists,
  readText,
  writeText,
  ensureDir,
  fileTimestamp,
  currentTimestamp,
  loadConfig,
  buildAgentContext,
  resolveAgentTaskScope,
  selectModelRoute,
  renderPrompt,
  requestAgent,
  observedUsage,
  providerUsage,
  checkProviders,
  createAccountUsage,
  isPlaceholder,
  getProviderRequestCount,
  setProviderRequestCount
}) {
  function inferRole(type) {
    if (type === "architect") return "architect";
    if (type === "review") return "reviewer";
    if (type === "docs") return "recorder";
    return "implementer";
  }

  function commandContext(args) {
    const { options } = parseArgs(args);
    const bundle = buildAgentContext(ROOT, {
      type: options.type || "code",
      role: options.role,
      taskName: options.task,
      executionMode: options["execution-mode"] || "standard",
      fullContext: Boolean(options["full-context"]),
      ...(options["max-bytes"] ? { maxBytes: Number(options["max-bytes"]) } : {})
    });
    log(options.json ? JSON.stringify(bundle, null, 2) : bundle.content);
    return bundle;
  }

  async function postJson(url, headers, body, requestOptions = {}) {
    if (typeof fetch !== "function") fail("Node fetch is unavailable. Use Node.js 18+.");
    const cfg = loadConfig().api;
    const maxRetries = requestOptions.maxRetries ?? cfg.maxRetries;
    const baseDelayMs = cfg.retryBaseMs;
    const maxDelayMs = cfg.retryMaxMs;
    const maxProviderRequests = Math.min(cfg.maxProviderRequests, requestOptions.maxProviderRequests ?? cfg.maxProviderRequests);
    if (![maxRetries, baseDelayMs, maxDelayMs].every((value) => Number.isFinite(value) && value >= 0)
        || !Number.isFinite(maxProviderRequests) || maxProviderRequests < 1) {
      fail("API retry settings must be non-negative, and HARNESS_MAX_PROVIDER_REQUESTS must be at least 1.");
    }

    const retryableStatus = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        const currentCount = getProviderRequestCount();
        if (currentCount >= maxProviderRequests) {
          const budgetError = new Error(`Provider request budget exhausted: ${currentCount}/${maxProviderRequests}`);
          budgetError.code = 1;
          budgetError.noRetry = true;
          throw budgetError;
        }
        setProviderRequestCount(currentCount + 1);
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body),
          ...(requestOptions.timeoutMs ? { signal: globalThis.AbortSignal.timeout(requestOptions.timeoutMs) } : {}),
        });
        const json = await response.json().catch(() => ({}));
        if (response.ok) return json;

        const details = JSON.stringify(json);
        const providerCode = String(json.error?.code || json.error?.type || "").toLowerCase();
        const quotaExhausted = ["insufficient_quota", "billing_hard_limit_reached", "credit_balance_too_low"]
          .some((code) => providerCode.includes(code));
        if (quotaExhausted || !retryableStatus.has(response.status) || attempt === maxRetries) {
          const apiError = new Error(`API request failed (${response.status}): ${details}`);
          apiError.code = 1;
          apiError.noRetry = true;
          throw apiError;
        }

        const retryAfter = response.headers.get("retry-after");
        let delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
        if (retryAfter) {
          const seconds = Number(retryAfter);
          const dateDelay = Date.parse(retryAfter) - Date.now();
          const requestedDelay = Number.isFinite(seconds) ? seconds * 1000 : dateDelay;
          if (Number.isFinite(requestedDelay) && requestedDelay >= 0) {
            delayMs = Math.min(maxDelayMs, requestedDelay);
          }
        }
        log(`[API] Retryable HTTP ${response.status}. Retrying in ${delayMs}ms (${attempt + 1}/${maxRetries}).`);
        await new Promise((resolve) => {
          setTimeout(resolve, delayMs);
        });
      } catch (err) {
        if (err.noRetry || attempt === maxRetries) throw err;
        const delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
        log(`[API] Network error: ${err.message}. Retrying in ${delayMs}ms (${attempt + 1}/${maxRetries}).`);
        await new Promise((resolve) => {
          setTimeout(resolve, delayMs);
        });
      }
    }
    fail("API request exhausted retry attempts.");
  }

  async function invokeBoundedAgent({ provider, model, systemPrompt, prompt, maxOutputTokens, maxRequests }) {
    const result = await requestAgent({
      provider,
      model,
      systemPrompt,
      prompt,
      maxOutputTokens,
      postJson: (url, headers, body) => postJson(url, headers, body, { maxRetries: 0, maxProviderRequests: maxRequests, timeoutMs: 60000 })
    });
    if (observedUsage(provider, result.response).total_tokens !== null) {
      try {
        providerUsage.record(provider, model, result.response);
      } catch {
        log("[WARN] Eval provider usage ledger write failed; run evidence is retained separately.");
      }
    }
    return result;
  }

  async function commandRunAgent(args, attribution = null) {
    parseEnvFile();
    const { positional, options } = parseArgs(args);
    applyExplicitTaskOption(options);
    const prompt = positional.join(" ").trim();
    if (!prompt) fail("Usage: node tools/harness-cli/index.js run-agent [--type code|architect|review|docs] [--role role] \"prompt\"");

    if ((process.env.HARNESS_AGENT_MODE || "interactive") !== "api") {
      fail("HARNESS_AGENT_MODE must be api to call provider APIs directly.");
    }

    const type = options.type || "default";
    const role = options.role || inferRole(type);
    if (!VALID_ROLES.has(role)) fail(`Unsupported role: ${role}`);

    const provider = providerUsage.activeProvider();
    const { localTicket } = resolveAgentTaskScope(ROOT, attribution, () => resolveTaskId({ strict: true }));
    let ticketRisk = attribution?.risk ?? options.risk;
    if (ticketRisk === undefined && localTicket && exists(`.harness/tasks/active/${localTicket}.md`)) {
      const match = readText(`.harness/tasks/active/${localTicket}.md`).match(/^## Risk\r?\n-\s*([^\r\n]+)/m);
      if (match) ticketRisk = match[1].trim();
    }
    let route;
    try {
      route = selectModelRoute(provider, {
        type,
        role,
        priority: attribution?.priority || options.priority,
        risk: ticketRisk,
        ticketKind: attribution?.ticket_kind,
        scopeCount: Array.isArray(attribution?.scope) ? attribution.scope.length : 0,
        attempt: options.attempt ?? attribution?.attempt ?? 1,
        repairRequired: Boolean(options.repair || attribution?.repair_required),
        tierOverride: options["model-tier"]
      }, process.env);
    } catch (error) {
      fail(error.message);
    }
    const model = route.model;
    if (ticketRisk === undefined || attribution?.risk_source === "legacy-default") {
      log("[WARN] Risk: low (legacy-default). Compatibility fallback, not a low-risk guarantee; review risk before approval.");
    }
    const rolePrompt = readText(`prompts/system/roles/${role}.md`);
    const context = buildAgentContext(ROOT, {
      type,
      role,
      taskName: localTicket,
      executionMode: options["execution-mode"] || "standard",
      includeProject: !attribution,
      fullContext: Boolean(options["full-context"] || attribution?.full_context)
    }).content;
    const systemPrompt = renderPrompt("prompts/templates/agent-system.md", {
      CONTEXT: context,
      ROLE: role,
      ROLE_PROMPT: rolePrompt,
      TYPE: type,
    });

    ensureDir("observability/traces");
    const logRel = `observability/traces/${fileTimestamp()}-${type}.log`;
    log("🤖 [Harness Agent]");
    log(`   Provider : ${provider}`);
    log(`   Model    : ${model} (tier=${route.tier}, reason=${route.reason})`);
    log(`   Role     : ${role}`);
    log(`   Task     : ${prompt}`);
    log(`   Log      : ${logRel}`);

    const { text, response: responseJson } = await requestAgent({ provider, model, systemPrompt, prompt, postJson });

    try {
      providerUsage.record(provider, model, responseJson, attribution);
    } catch (error) {
      log(`[WARN] Provider usage could not be recorded: ${error.message}`);
    }

    log("─────────────────────────────────────────────────────────");
    log(text);
    writeText(logRel, [
      "======================================================",
      "Harness Agent Log",
      `Timestamp : ${currentTimestamp()}`,
      `Provider  : ${provider}`,
      `Model     : ${model}`,
      `Tier      : ${route.tier} (${route.reason})`,
      `Task-Type : ${type}`,
      `Role      : ${role}`,
      `Task      : ${prompt}`,
      "======================================================",
      "",
      text,
    ].join("\n"));
    return text;
  }

  function commandProvider(args) {
    parseEnvFile();
    const { positional, options } = parseArgs(args);
    const action = positional[0] || "status";

    if (action === "check") {
      return checkProviders({ provider: options.provider, isPlaceholder })
        .then(report => { log(JSON.stringify(report, null, 2)); return report; });
    }

    if (action === "account-usage") {
      return createAccountUsage({ root: ROOT })({ from: options.from, to: options.to, provider: options.provider, refresh: Boolean(options.refresh) })
        .then(report => { log(JSON.stringify(report, null, 2)); return report; });
    }

    if (action === "use") {
      const provider = positional[1];
      if (!provider) fail("Usage: provider use <openai|anthropic|gemini>");
      providerUsage.use(provider);
      if (!options.json) log(`Active provider changed to ${provider}.`);
    } else if (!["status", "list", "usage"].includes(action)) {
      fail("Usage: provider <status|list|usage|use|check|account-usage> [provider] [--provider openai|anthropic|gemini] [--json]");
    }

    const report = providerUsage.status({ cost: Boolean(options.cost) });
    if (options.json) {
      log(JSON.stringify(report, null, 2));
      return report;
    }

    log(`[Provider] ${report.month} usage`);
    log(`Active: ${report.active_provider}`);
    for (const item of report.providers) {
      const marker = item.active ? "*" : " ";
      const configured = item.configured ? "configured" : "missing-key";
      const remaining = item.remaining_tokens === null
        ? "unknown"
        : `${item.remaining_tokens.toLocaleString()} (${item.remaining_percent}%)`;
      log(`${marker} ${item.provider.padEnd(10)} ${configured.padEnd(12)} used=${item.observed_usage.total_tokens.toLocaleString()} remaining=${remaining}`);
    }
    if (options.cost) {
      for (const item of report.providers) {
        log(`[Cost] ${item.provider}: ${item.estimated_cost.usd === null ? "unknown" : "$" + item.estimated_cost.usd} (reference observed estimate, not invoice/balance)`);
      }
    }
    log("Remote account remaining is unknown without provider-specific admin billing credentials.");
    return report;
  }

  return {
    inferRole,
    commandContext,
    postJson,
    invokeBoundedAgent,
    commandRunAgent,
    commandProvider
  };
}

module.exports = { createAgentApiCommands };
