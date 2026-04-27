#!/bin/bash
# ==============================================================================
# [Harness] 4단계: 전체 검증 (테스트 + 린트 + 빌드)
# Usage: bash scripts/verify-task.sh
# ==============================================================================

source "$(dirname "$0")/utils.sh"

# ── 로그 설정 ──────────────────────────────────────────────────────────────────
mkdir -p .harness/logs
VERIFY_LOG=".harness/logs/$(date +"%Y-%m-%d_%H-%M-%S")-verify.log"
exec > >(tee -a "$VERIFY_LOG") 2>&1

echo "🔍 [Harness] 검증 시작... (로그: $VERIFY_LOG)"
send_slack_notification "info" "🔍 검증 파이프라인 시작"

# 프로젝트 타입 자동 감지
if [ -f "build.gradle" ] || [ -f "build.gradle.kts" ]; then
  # Java / Gradle 프로젝트
  echo "▶️ [Java] 테스트 실행..."
  ./gradlew test
  if [ $? -ne 0 ]; then
    send_slack_notification "fail" "❌ 테스트 실패"
    exit 1
  fi

  echo "▶️ [Java] 빌드 확인..."
  ./gradlew build -x test
  if [ $? -ne 0 ]; then
    send_slack_notification "fail" "❌ 빌드 실패"
    exit 1
  fi

elif [ -f "package.json" ]; then
  # Node.js / 프론트엔드 프로젝트
  echo "▶️ [Node] 테스트 실행..."
  npm run test
  if [ $? -ne 0 ]; then
    send_slack_notification "fail" "❌ 테스트 실패"
    exit 1
  fi

  echo "▶️ [Node] 린트 확인..."
  npm run lint
  if [ $? -ne 0 ]; then
    send_slack_notification "fail" "❌ 린트 실패"
    exit 1
  fi

  echo "▶️ [Node] 빌드 확인..."
  npm run build
  if [ $? -ne 0 ]; then
    send_slack_notification "fail" "❌ 빌드 실패"
    exit 1
  fi
else
  echo "⚠️ 알 수 없는 프로젝트 타입. 수동으로 검증하십시오."
  exit 1
fi

echo "✅ 모든 검증 통과. 커밋 가능."
send_slack_notification "success" "✅ 검증 완료! 모든 테스트/빌드 통과."
