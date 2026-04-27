#!/bin/bash
# ==============================================================================
# [Harness] 1단계: 태스크 시작 — 워크트리 + EXEC_PLAN 생성
# Usage: bash scripts/start-task.sh <task-name> <type: feat|fix|refactor>
# ==============================================================================

TASK_NAME=$1
TASK_TYPE=$2

if [ -z "$TASK_NAME" ] || [ -z "$TASK_TYPE" ]; then
  echo "❌ 사용법: bash scripts/start-task.sh <task-name> <feat|fix|refactor>"
  exit 1
fi

BRANCH_NAME="${TASK_TYPE}/${TASK_NAME}"
WORKTREE_DIR=".worktrees/${TASK_NAME}"
PLAN_FILE=".harness/tasks/active/${TASK_NAME}.md"

echo "🚀 [Harness] Task 시작: $TASK_NAME"

# 워크트리 생성
mkdir -p .worktrees
git worktree add -b "$BRANCH_NAME" "$WORKTREE_DIR" master
if [ $? -ne 0 ]; then
  echo "❌ 워크트리 생성 실패."
  exit 1
fi

# EXEC_PLAN 생성
mkdir -p .harness/tasks/active
cat <<EOF > "$PLAN_FILE"
# EXEC_PLAN: $TASK_NAME ($TASK_TYPE)

## 🎯 목표 (Goal)
- [여기에 목표 작성]

## 🛠️ 접근법 (Approach)
- [구현 방법 작성]

## ✅ 단계별 계획
- [ ] Step 1:
- [ ] Step 2:

## 💡 가정 (Assumptions)
- (모호한 요구사항에 대해 내린 가정 명시)

## 🏁 완료 기준
- [ ] 모든 테스트 통과
- [ ] Lint 에러 없음
- [ ] verify-task.sh 통과
EOF

echo "✅ 워크트리: $WORKTREE_DIR"
echo "✅ EXEC_PLAN: $PLAN_FILE"
echo "👉 작업 시작: cd $WORKTREE_DIR"

# ── 인사이트 로그: 시작 시각 기록 ───────────────────────────────────────────
mkdir -p .harness/logs
START_LOG=".harness/logs/${TASK_NAME}.start.json"
cat > "$START_LOG" <<EOF
{
  "task": "$TASK_NAME",
  "type": "$TASK_TYPE",
  "started_at": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "project": "$(basename $(git rev-parse --show-toplevel 2>/dev/null || echo 'unknown'))"
}
EOF
echo "📊 인사이트 로그 기록: $START_LOG"
