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

if [ $# -lt 1 ]; then
  echo "Usage: bash scripts/start-ticket.sh <ticket-name>"
  exit 1
fi

TICKET_NAME="$1"
BACKLOG_FILE=".harness/tasks/backlog/${TICKET_NAME}.md"
ACTIVE_FILE=".harness/tasks/active/${TICKET_NAME}.md"

if [ ! -f "$BACKLOG_FILE" ]; then
  echo "Error: backlog ticket not found: $BACKLOG_FILE"
  exit 1
fi

if [ -e "$ACTIVE_FILE" ]; then
  echo "Error: active task already exists: $ACTIVE_FILE"
  exit 1
fi

mkdir -p .harness/tasks/active
mv "$BACKLOG_FILE" "$ACTIVE_FILE"

echo "Promoted ticket to active: $ACTIVE_FILE"
echo "Next: implement, verify, commit, then archive with complete-task."
