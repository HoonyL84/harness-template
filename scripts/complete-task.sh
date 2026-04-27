#!/bin/bash
# ==============================================================================
# [Harness] 5단계: 태스크 완료 및 정리 (Garbage Collection)
# Usage: bash scripts/complete-task.sh <task-name>
# ==============================================================================

TASK_NAME=$1

if [ -z "$TASK_NAME" ]; then
  echo "❌ 사용법: bash scripts/complete-task.sh <task-name>"
  exit 1
fi

WORKTREE_DIR=".worktrees/${TASK_NAME}"
PLAN_FILE=".harness/tasks/active/${TASK_NAME}.md"
ARCHIVE_DIR=".harness/tasks/archive"

source "$(dirname "$0")/utils.sh"

echo "🧹 [Harness] Task 완료 처리: $TASK_NAME"
send_slack_notification "success" "🎊 Task [$TASK_NAME] 완료. GC 시작..."

# 워크트리 삭제
if [ -d "$WORKTREE_DIR" ]; then
  git worktree remove -f "$WORKTREE_DIR"
  git branch -D "feat/$TASK_NAME" 2>/dev/null || \
  git branch -D "fix/$TASK_NAME" 2>/dev/null || \
  git branch -D "refactor/$TASK_NAME" 2>/dev/null
  echo "✅ 워크트리 삭제 완료"
else
  echo "⚠️ 워크트리 없음: $WORKTREE_DIR"
fi

# EXEC_PLAN 아카이브
if [ -f "$PLAN_FILE" ]; then
  mkdir -p "$ARCHIVE_DIR"
  mv "$PLAN_FILE" "$ARCHIVE_DIR/${TASK_NAME}.md"
  echo "✅ EXEC_PLAN 아카이브 완료"
fi

echo "✅ Task [$TASK_NAME] 정리 완료."

# ── 인사이트 로그: 최종 기록 생성 ───────────────────────────────────────────
START_LOG=".harness/logs/${TASK_NAME}.start.json"
VERIFY_LOG=".harness/logs/${TASK_NAME}.verify.json"
INSIGHT_LOG=".harness/logs/${TASK_NAME}.done.json"

STARTED_AT="unknown"
TASK_TYPE="unknown"
PROJECT="unknown"
REWORK_COUNT=0
LAST_FAIL_REASON="none"

if [ -f "$START_LOG" ]; then
  STARTED_AT=$(grep -o '"started_at":"[^"]*"' "$START_LOG" | cut -d'"' -f4)
  TASK_TYPE=$(grep -o '"type":"[^"]*"' "$START_LOG" | cut -d'"' -f4)
  PROJECT=$(grep -o '"project":"[^"]*"' "$START_LOG" | cut -d'"' -f4)
fi
if [ -f "$VERIFY_LOG" ]; then
  REWORK_COUNT=$(grep -o '"rework_count":[0-9]*' "$VERIFY_LOG" | grep -o '[0-9]*' || echo 0)
  LAST_FAIL_REASON=$(grep -o '"last_fail_reason":"[^"]*"' "$VERIFY_LOG" | cut -d'"' -f4 || echo "none")
fi

COMPLETED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat > "$INSIGHT_LOG" <<EOF
{
  "task": "$TASK_NAME",
  "type": "$TASK_TYPE",
  "project": "$PROJECT",
  "started_at": "$STARTED_AT",
  "completed_at": "$COMPLETED_AT",
  "rework_count": $REWORK_COUNT,
  "last_fail_reason": "$LAST_FAIL_REASON"
}
EOF

# 임시 로그 정리
rm -f "$START_LOG" "$VERIFY_LOG"
echo "📊 인사이트 기록 완료: $INSIGHT_LOG"
