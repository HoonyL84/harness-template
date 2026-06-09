#!/bin/bash
# ==============================================================================
# [Harness] AI agent trigger
# Usage:
#   bash scripts/run-agent.sh [--type <task-type>] [--role <agent-role>] "태스크 설명"
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

node tools/harness-cli/index.js run-agent "$@"
