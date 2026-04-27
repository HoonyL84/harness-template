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

  if grep -q "jacoco" build.gradle* 2>/dev/null; then
    echo "▶️ [Java] 테스트 커버리지 검증 (목표: 80%+)..."
    ./gradlew jacocoTestCoverageVerification
    if [ $? -ne 0 ]; then
      send_slack_notification "fail" "❌ 테스트 커버리지 기준 미달"
      exit 1
    fi
  fi

  echo "▶️ [Java] 빌드 확인..."
  ./gradlew build -x test
  if [ $? -ne 0 ]; then
    send_slack_notification "fail" "❌ 빌드 실패"
    exit 1
  fi

elif [ -f "package.json" ]; then
  # Node.js / 프론트엔드 프로젝트
  echo "▶️ [Node] 테스트 및 커버리지 검증..."
  if grep -q "\"coverage\":" package.json; then
    npm run coverage
  else
    npm run test -- --coverage
  fi
  if [ $? -ne 0 ]; then
    send_slack_notification "fail" "❌ 테스트 또는 커버리지 검증 실패"
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

# ── AI 의미적 검증 (Semantic Invariant Enforcement) ────────────────────────────────
echo "▶️ [AI] 의미적 아키텍처 검증 (Semantic Review)..."
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  DIFF_CONTENT=$(git diff HEAD 2>/dev/null | head -n 500) # 최대 500줄 제한
  if [ -n "$DIFF_CONTENT" ]; then
    echo "   변경된 코드를 core-beliefs.md 원칙에 따라 검사 중..."
    
    # 임시 프롬프트 생성 (명령어 길이 제한 방지)
    PROMPT_FILE=".harness/logs/semantic-prompt.txt"
    echo -e "아래 변경사항(git diff)을 검토하여 docs/design-docs/core-beliefs.md 의 아키텍처 원칙(레이어 의존성, 캡슐화 등)을 위반한 부분이 있는지 확인해줘.\n위반 사항이 있다면 명확히 'FAIL: 이유' 형식으로 출력하고, 완벽히 준수했다면 'PASS'라고만 출력해줘.\n\n$DIFF_CONTENT" > "$PROMPT_FILE"
    
    AI_REVIEW_RESULT=$(bash scripts/run-agent.sh --type review "$(cat "$PROMPT_FILE")")
    
    if echo "$AI_REVIEW_RESULT" | grep -q "FAIL"; then
      echo -e "\n❌ [AI Review] 아키텍처 원칙 위반 감지!"
      echo "$AI_REVIEW_RESULT" | grep "FAIL" -A 5
      send_slack_notification "fail" "❌ AI 의미적 검증 실패 (아키텍처 위반)"
      exit 1
    else
      echo "✅ [AI Review] 아키텍처 원칙 준수 확인 (PASS)"
    fi
  else
    echo "ℹ️ 변경된 파일이 없어 AI 검증을 건너뜁니다."
  fi
fi

echo "✅ 모든 검증 통과. 커밋 가능."
send_slack_notification "success" "✅ 검증 완료! 모든 테스트/빌드 통과."
