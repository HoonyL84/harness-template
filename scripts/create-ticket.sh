#!/bin/bash
# ==============================================================================
# [Harness] Backlog ticket creator
# Usage:
#   bash scripts/create-ticket.sh <ticket-name> <feat|fix|refactor|docs|chore|experiment> --goal "..."
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

node tools/harness-cli/index.js create-ticket "$@"
