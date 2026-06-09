#!/bin/bash
# ============================================================================
# [Harness] Verify task
# Usage: bash scripts/verify-task.sh [--offline] [--diagnose]
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

node tools/harness-cli/index.js verify "$@"
