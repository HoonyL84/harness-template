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
