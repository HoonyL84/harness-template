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

if [ $# -lt 2 ]; then
  echo "Usage: bash scripts/create-ticket.sh <ticket-name> <feat|fix|refactor|docs|chore|experiment> --goal \"...\""
  exit 1
fi

TICKET_NAME="$1"
TICKET_TYPE="$2"
shift 2

if [[ ! "$TICKET_TYPE" =~ ^(feat|fix|refactor|docs|chore|experiment)$ ]]; then
  echo "Error: ticket type must be one of feat, fix, refactor, docs, chore, experiment"
  exit 1
fi

GOAL=""
SCOPE=""
OUT_OF_SCOPE=""
ACCEPTANCE=""
RISK=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --goal)
      GOAL="${2:-}"
      shift 2
      ;;
    --scope)
      SCOPE="${2:-}"
      shift 2
      ;;
    --out-of-scope)
      OUT_OF_SCOPE="${2:-}"
      shift 2
      ;;
    --acceptance)
      ACCEPTANCE="${2:-}"
      shift 2
      ;;
    --risk)
      RISK="${2:-}"
      shift 2
      ;;
    *)
      echo "Unknown option: $1"
      exit 1
      ;;
  esac
done

if [ -z "$GOAL" ]; then
  echo "Error: --goal is required"
  exit 1
fi

mkdir -p .harness/tasks/backlog
TICKET_FILE=".harness/tasks/backlog/${TICKET_NAME}.md"

if [ -e "$TICKET_FILE" ]; then
  echo "Error: ticket already exists: $TICKET_FILE"
  exit 1
fi

cat > "$TICKET_FILE" <<EOF
# TICKET: ${TICKET_NAME}

## Type
${TICKET_TYPE}

## Goal
- ${GOAL}

## Scope
- ${SCOPE:-[작성 필요]}

## Out of Scope
- ${OUT_OF_SCOPE:-[작성 필요]}

## Acceptance Criteria
- [ ] ${ACCEPTANCE:-검증 기준 작성}

## Risk
- ${RISK:-낮음}

## Notes
- Created from backlog workflow.
EOF

echo "Created ticket: $TICKET_FILE"
