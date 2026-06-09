#!/bin/bash
# ==============================================================================
# [Harness] Smoke Test for CLI Flow
# Usage: bash scripts/smoke-test.sh
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

TICKET_NAME="smoke-test-ticket"

echo "[Smoke Test] Cleaning up old test files..."
rm -f ".harness/tasks/backlog/$TICKET_NAME.md"
rm -f ".harness/tasks/active/$TICKET_NAME.md"
rm -f ".harness/tasks/archive/$TICKET_NAME.md"
rm -f "observability/metrics/$TICKET_NAME.verify.json"
rm -f "observability/metrics/$TICKET_NAME.start.json"
rm -f "observability/metrics/$TICKET_NAME.done.json"

echo "[Smoke Test] 1. Running check..."
bash scripts/check-environment.sh

echo "[Smoke Test] 2. Creating ticket..."
bash scripts/create-ticket.sh "$TICKET_NAME" "chore" \
  --goal "Verify cli quoting works" \
  --scope "Test scope with spaces" \
  --out-of-scope "Test out of scope" \
  --acceptance "Test criteria" \
  --risk "low"

if [ ! -f ".harness/tasks/backlog/$TICKET_NAME.md" ]; then
  echo "Error: Backlog ticket file was not created."
  exit 1
fi

echo "[Smoke Test] 3. Starting ticket..."
bash scripts/start-ticket.sh "$TICKET_NAME"

if [ ! -f ".harness/tasks/active/$TICKET_NAME.md" ]; then
  echo "Error: Active ticket file was not created."
  exit 1
fi

echo "[Smoke Test] 4. Verifying task..."
export TASK_ID="$TICKET_NAME"
bash scripts/verify-task.sh --offline

if [ ! -f "observability/metrics/$TICKET_NAME.verify.json" ]; then
  echo "Error: Verify metric JSON file was not created."
  exit 1
fi

echo "[Smoke Test] 5. Completing task..."
node tools/harness-cli/index.js complete-task "$TICKET_NAME"

if [ ! -f ".harness/tasks/archive/$TICKET_NAME.md" ]; then
  echo "Error: Archive ticket file was not created."
  exit 1
fi

if [ ! -f "observability/metrics/$TICKET_NAME.done.json" ]; then
  echo "Error: Done metric JSON file was not created."
  exit 1
fi

echo "[Smoke Test] Cleaning up test files..."
rm -f ".harness/tasks/archive/$TICKET_NAME.md"
rm -f "observability/metrics/$TICKET_NAME.done.json"

echo "[Smoke Test] Success! Complete harness flow works seamlessly."
