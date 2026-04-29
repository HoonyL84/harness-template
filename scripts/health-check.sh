#!/bin/bash
# ============================================================================
# [Harness] Health Check
# Usage: bash scripts/health-check.sh
# ============================================================================

set -u

FAILED=0
WARNED=0

pass() { echo "[PASS] $1"; }
warn() { echo "[WARN] $1"; WARNED=$((WARNED + 1)); }
fail() { echo "[FAIL] $1"; FAILED=$((FAILED + 1)); }

echo "[Harness] Health check started"

REQUIRED_DIRS=(
  "docs"
  "scripts"
  "prompts/system"
  "prompts/templates"
  "prompts/fragments"
  "tools/mcp"
  "tools/local"
  "memory/working"
  "memory/semantic"
  "memory/episodic"
  "memory/procedural"
  "evals/per_skill"
  "evals/compositional"
  "evals/regression"
  "observability/traces"
  "observability/events"
  "observability/metrics"
)

REQUIRED_FILES=(
  "AGENTS.md"
  "README.md"
  "docs/project/PLANS.md"
  "docs/design-docs/core-beliefs.md"
  "docs/design-docs/tech-stack.md"
  "tools/registry.yaml"
  ".env.template"
)

for dir in "${REQUIRED_DIRS[@]}"; do
  if [ -d "$dir" ]; then
    pass "Directory exists: $dir"
  else
    fail "Missing directory: $dir"
  fi
done

for file in "${REQUIRED_FILES[@]}"; do
  if [ -f "$file" ]; then
    pass "File exists: $file"
  else
    fail "Missing file: $file"
  fi
done

ACTIVE_DIR=".harness/tasks/active"
if [ -d "$ACTIVE_DIR" ]; then
  OLD_TASK_COUNT=$(find "$ACTIVE_DIR" -name "*.md" -mtime +14 2>/dev/null | wc -l | tr -d ' ')
  if [ "$OLD_TASK_COUNT" -gt 0 ]; then
    warn "Stale active tasks (>14 days): $OLD_TASK_COUNT"
  else
    pass "No stale active tasks"
  fi
else
  warn "No active task directory: $ACTIVE_DIR"
fi

VERIFY_FILES_COUNT=$(find "observability/metrics" -name "*.verify.json" 2>/dev/null | wc -l | tr -d ' ')
if [ "$VERIFY_FILES_COUNT" -eq 0 ]; then
  warn "No verify result found in observability/metrics"
else
  LATEST_VERIFY=$(ls -t observability/metrics/*.verify.json 2>/dev/null | head -n 1)
  if grep -q '"result": "pass"' "$LATEST_VERIFY"; then
    pass "Latest verify status is pass: $LATEST_VERIFY"
  else
    warn "Latest verify status is not pass: $LATEST_VERIFY"
  fi
fi

echo "----------------------------------------"
echo "Health check complete: fail=$FAILED warn=$WARNED"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi

exit 0
