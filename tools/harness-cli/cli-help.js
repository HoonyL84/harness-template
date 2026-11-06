"use strict";

function printHelp(log, args = []) {
  if (!args.includes("--all")) {
    log(`Harness CLI

Daily workflow (npm run harness -- <command>; PowerShell: npm.cmd):
  dashboard [--json]                       Project and work overview
  request capture <id> --input-file <json>  Record request and selected sources
  request draft <id> --output-file <json>   Validate detailed plan and test plan
  request planning <id>                    Inspect evidence and open questions
  request planning-review <id> --review-file <json>
  request approve <id>                     Human plan approval
  execution prepare <id>                   Prepare approved worktrees
  runner run <id>                          Execute and verify approved tickets
  history search --query <text>            Find work and evidence
  verify --full --task <ticket>            Required completion gate

Git release still requires explicit human approval and current verification.
Guide: docs/PLANNING_QUALITY_GUIDE.md (standard planning path)
Setup/single-repo: docs/HARNESS_GUIDE.md
All commands, integrations, recovery and experimental modes: help --all
`);
    return;
  }
  log(`Harness CLI

[Multi-Project Control Plane]
  node tools/harness-cli/index.js dashboard [--json] [--cost] [--check-connections] [--notify]
  node tools/harness-cli/index.js bootstrap <request|approve|apply|status> <id> [--path <project-root>] [--summary <text>] [--message <commit-message>]
  node tools/harness-cli/index.js project <add|list|show|check|context|onboard|profile|remove> [id] [--path <git-root>] [--bundle] [--approve] [--json]
  node tools/harness-cli/index.js project context ID --bundle [--request ID --ticket ID] [--query TEXT] [--max-files N] [--max-bytes N]
  node tools/harness-cli/index.js request <create|revise|show|approve|ready> <id> [--project <id,...>] [--goal <text>] [--plan-file <json>]
  node tools/harness-cli/index.js request import-jira <id> --project <id> --issues <KEY-1,KEY-2>
  node tools/harness-cli/index.js request priority <id> --ticket <id> --value <P0|P1|P2|P3>
  node tools/harness-cli/index.js request capture <id> --input-file <json>
  node tools/harness-cli/index.js request draft <id> --output-file <json>
  node tools/harness-cli/index.js request planning <id>
  node tools/harness-cli/index.js request planning-review <id> --review-file <json>
  node tools/harness-cli/index.js request generate <id> --provider <openai|anthropic|gemini> [--model-tier standard|strong] [--live --approve-send --max-requests 1 --input-fingerprint <sha256>]
  node tools/harness-cli/index.js execution <prepare|advance|review-ready|status> <request-id>
  node tools/harness-cli/index.js runner <run|reconcile|status|notify> <request-id> [--ticket <ticket-id>] [--max-attempts N] [--max-tickets N] [--full-context]
  node tools/harness-cli/index.js release request <request-id> [--ticket <id>] [--approval <id>] --summary "..." [--operation record|commit|push|merge]
  node tools/harness-cli/index.js release <approve|apply|consume> <request-id> --fingerprint <sha256>
  node tools/harness-cli/index.js release status <request-id>
  node tools/harness-cli/index.js deployment <record|list|show> [id] [--file <json>] [--project <id>] [--environment <name>] [--status <status>]
  node tools/harness-cli/index.js history <list|search|export|refresh|review|status|report|measure|map-check|audit-tasks> [--project id] [--request id] [--ticket id] [--ticket-kind development|planning|design]
  node tools/harness-cli/index.js evidence add --file <json>
  node tools/harness-cli/index.js evidence search [--query <text>] [--project <id>] [--technology <name>] [--from <date>] [--to <date>] [--include-drafts]
  node tools/harness-cli/index.js evidence export [--format json]

[Single-Repo Mode]
  node tools/harness-cli/index.js check
  node tools/harness-cli/index.js create-ticket <name> <type> --goal "..."
  node tools/harness-cli/index.js start-ticket <name> [--from-review]
  node tools/harness-cli/index.js verify [--quick|--full] [--offline] [--diagnose] [--auto-fix]
  node tools/harness-cli/index.js complete-task <name> [--force]
  node tools/harness-cli/index.js context [--task <ticket>] [--type code|architect|review] [--role reviewer|architect] [--execution-mode standard|auto-fix|l5|orchestrate] [--full-context] [--max-bytes <n>] [--json]
  node tools/harness-cli/index.js run-agent [--type type] [--role role] [--execution-mode standard|auto-fix|l5|orchestrate] [--model-tier fast|standard|strong] "prompt"
  node tools/harness-cli/index.js orchestrate <ticket> [--mode auto|native|api|sequential]
  node tools/harness-cli/index.js orchestrate <--capabilities|--status <run-id>|--resume <run-id>|--begin-review <run-id>|--promote <run-id> --approve-risk|--finish <run-id>>
  node tools/harness-cli/index.js autonomy [--status] [--verify-current] [--approve-risk] [--iterations N]
  node tools/harness-cli/index.js memory check
  node tools/harness-cli/index.js notifications list
  node tools/harness-cli/index.js notifications retry <event-id>

[Integrations & Recovery]
  node tools/harness-cli/index.js atlassian <connect|check|discover|map|queue-ticket|queue-status|queue-result|preview|sync|retry-rejected|reconcile|search|context|priority-plan|priority-apply|priority-show|priority-reconcile|status>
  node tools/harness-cli/index.js atlassian connect --site https://your-site.atlassian.net [--cloud-id UUID] [--transport mcp|rest]
  node tools/harness-cli/index.js atlassian map --project ID --jira-project KEY --issue-type ID --space-id ID [--parent-id ID] [--context-pages ID,ID] [--priority-map ID:P0,ID:P1,ID:P2,ID:P3]
  node tools/harness-cli/index.js atlassian workflow --project ID --running ID --blocked ID --review-ready ID --completed ID
  node tools/harness-cli/index.js atlassian consent <preview|grant|status|revoke> --project ID [--approve SCOPE_DIGEST]
  node tools/harness-cli/index.js atlassian <recovery [outbox-entry-id]|mcp-tools|discover [--jira-project KEY] [--space-id ID]|link <request-id> --ticket <ticket-id>>
  node tools/harness-cli/index.js operations flush <--request ID|--project ID>
  node tools/harness-cli/index.js operations <audit|repair|prepare ID|annotate ID --file JSON> [--project ID]
  node tools/harness-cli/index.js backup <create [--output FILE]|inspect --file FILE|restore --file FILE [--approve PREVIEW_ID]>
  node tools/harness-cli/index.js cleanup [--dry-run] [--approve <id>]
  node tools/harness-cli/index.js scan-drift
  node tools/harness-cli/index.js recover

[Evals, Provider & Diagnostics]
  node tools/harness-cli/index.js eval <list|run|show|compare|review> [id] [--provider NAME --model NAME] [--cases ID,ID] [--live --max-requests N --max-attempts N]
  node tools/harness-cli/index.js eval planning <list|run|import|show|compare|review> [id] [--responses-file <json>]
  node tools/harness-cli/skill-eval.js [--skill <name>] <--cases|--responses <json-file>|--list-skills>
  node tools/harness-cli/index.js provider <status|list|usage|check> [--provider openai|anthropic|gemini] [--json] [--cost]
  node tools/harness-cli/index.js provider use <openai|anthropic|gemini> [--json]
  node tools/harness-cli/index.js provider account-usage [--provider openai|anthropic|gemini] [--from YYYY-MM-DD --to YYYY-MM-DD] [--refresh]
  node tools/harness-cli/index.js <validate-auto-fix <patch-file>|validate-l5-patch <patch-file>|validate-prompts|validate-api-retry|validate-recovery|validate-l5-soak [--cycles N]>
`);
}

module.exports = { printHelp };
