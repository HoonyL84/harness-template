#!/bin/bash
# ==============================================================================
# [Harness] Promote a backlog ticket to active
# Usage:
#   bash scripts/start-ticket.sh <ticket-name>
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

node tools/harness-cli/index.js start-ticket "$@"
