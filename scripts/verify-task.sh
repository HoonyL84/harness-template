#!/bin/bash
# ============================================================================
# [Harness] 4단계: 전체 검증 (테스트 + 린트 + 빌드)
# Usage: bash scripts/verify-task.sh [--offline]
#   --offline: Skip Slack notification and AI semantic review.
# ============================================================================

source "$(dirname "$0")/utils.sh"

OFFLINE_MODE=false
if [ "$1" == "--offline" ] || [ "${HARNESS_OFFLINE}" == "1" ] || [ "${HARNESS_OFFLINE}" == "true" ]; then
  OFFLINE_MODE=true
fi

notify() {
  local status="$1"
  local message="$2"
  if [ "$OFFLINE_MODE" == "true" ]; then
    return 0
  fi
  send_slack_notification "$status" "$message"
}

mkdir -p observability/traces observability/metrics
VERIFY_LOG="observability/traces/$(date +"%Y-%m-%d_%H-%M-%S")-verify.log"
exec > >(tee -a "$VERIFY_LOG") 2>&1

echo "[Harness] Verify start... (log: $VERIFY_LOG)"
if [ "$OFFLINE_MODE" == "true" ]; then
  echo "[OFFLINE] Slack/AI review skipped"
fi
notify "info" "Verify pipeline started"

_log_verify_fail() {
  local reason="$1"
  local task_name
  task_name=$(git rev-parse --abbrev-ref HEAD 2>/dev/null | sed 's|.*/||')
  local log_file="observability/metrics/${task_name}.verify.json"
  local count=0
  if [ -f "$log_file" ]; then
    count=$(grep -o '"rework_count":[0-9]*' "$log_file" | grep -o '[0-9]*' || echo 0)
  fi
  count=$((count + 1))
  cat > "$log_file" <<LOGEOF
{
  "task": "$task_name",
  "last_verify": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "result": "fail",
  "last_fail_reason": "$reason",
  "rework_count": $count
}
LOGEOF
}

MAX_RETRIES=1
RETRY_DELAY=3

_retry_command() {
  local cmd="$1"
  local step_name="$2"
  local attempt=0
  local status=0

  while [ $attempt -le $MAX_RETRIES ]; do
    eval "$cmd"
    status=$?

    if [ $status -eq 0 ]; then
      return 0
    fi

    attempt=$((attempt + 1))
    if [ $attempt -le $MAX_RETRIES ]; then
      echo "[$step_name] failed. Retry in ${RETRY_DELAY}s... ($attempt/$MAX_RETRIES)"
      sleep $RETRY_DELAY
    fi
  done

  return $status
}

if [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
  echo "[Java] Running tests..."
  _retry_command "./gradlew test" "test"
  if [ $? -ne 0 ]; then
    _log_verify_fail "test"
    notify "fail" "Tests failed"
    exit 1
  fi

  if grep -q "jacoco" build.gradle* 2>/dev/null; then
    echo "[Java] Checking coverage (target: 80%+)..."
    _retry_command "./gradlew jacocoTestCoverageVerification" "coverage"
    if [ $? -ne 0 ]; then
      _log_verify_fail "coverage"
      notify "fail" "Coverage verification failed"
      exit 1
    fi
  fi

  echo "[Java] Build check..."
  _retry_command "./gradlew build -x test" "build"
  if [ $? -ne 0 ]; then
    _log_verify_fail "build"
    notify "fail" "Build failed"
    exit 1
  fi

elif [ -f "package.json" ]; then
  echo "[Node] Running tests/coverage..."
  test_cmd="npm run test -- --coverage"
  if grep -q '"coverage":' package.json; then
    test_cmd="npm run coverage"
  fi

  _retry_command "$test_cmd" "test"
  if [ $? -ne 0 ]; then
    _log_verify_fail "test"
    notify "fail" "Test or coverage failed"
    exit 1
  fi

  echo "[Node] Lint check..."
  _retry_command "npm run lint" "lint"
  if [ $? -ne 0 ]; then
    _log_verify_fail "lint"
    notify "fail" "Lint failed"
    exit 1
  fi

  echo "[Node] Build check..."
  _retry_command "npm run build" "build"
  if [ $? -ne 0 ]; then
    _log_verify_fail "build"
    notify "fail" "Build failed"
    exit 1
  fi
else
  echo "No supported project type detected. Please verify manually."
  exit 1
fi

if [ "$OFFLINE_MODE" != "true" ]; then
  echo "[AI] Semantic review against core-beliefs..."
  if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    DIFF_CONTENT=$(git diff HEAD 2>/dev/null | head -n 500)
    if [ -n "$DIFF_CONTENT" ]; then
      PROMPT_FILE="observability/traces/semantic-prompt.txt"
      echo -e "Review the following git diff against docs/design-docs/core-beliefs.md.\nIf there is a violation, output: FAIL: <reason>.\nIf compliant, output: PASS\n\n$DIFF_CONTENT" > "$PROMPT_FILE"

      AI_REVIEW_RESULT=$(bash scripts/run-agent.sh --type review "$(cat "$PROMPT_FILE")")

      if echo "$AI_REVIEW_RESULT" | grep -q "FAIL"; then
        echo "[AI Review] Policy violation detected"
        echo "$AI_REVIEW_RESULT" | grep "FAIL" -A 5
        notify "fail" "AI semantic review failed"
        exit 1
      else
        echo "[AI Review] PASS"
      fi
    else
      echo "No code diff found. Skipping AI review."
    fi
  fi
else
  echo "[OFFLINE] AI semantic review skipped"
fi

echo "All checks passed. Safe to commit."
notify "success" "Verify completed successfully"

TASK_NAME=$(git rev-parse --abbrev-ref HEAD 2>/dev/null | sed 's|.*/||')
VERIFY_RESULT_LOG="observability/metrics/${TASK_NAME}.verify.json"
EXISTING_COUNT=0
if [ -f "$VERIFY_RESULT_LOG" ]; then
  EXISTING_COUNT=$(grep -o '"rework_count":[0-9]*' "$VERIFY_RESULT_LOG" | grep -o '[0-9]*' || echo 0)
fi

cat > "$VERIFY_RESULT_LOG" <<EOF
{
  "task": "$TASK_NAME",
  "last_verify": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "result": "pass",
  "rework_count": $EXISTING_COUNT
}
EOF
