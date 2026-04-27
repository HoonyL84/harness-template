#!/bin/bash
# ==============================================================================
# [Harness] 큰 기능을 작은 태스크로 자동 분해
#
# Usage:
#   bash scripts/decompose-task.sh "광고 서비스 전체 구현해줘"
#
# 동작:
#   1. AI가 PLANS.md + AGENTS.md 컨텍스트를 읽고 태스크를 분해
#   2. 분해된 태스크 목록을 출력
#   3. 선택 시 각 태스크의 워크트리 + EXEC_PLAN 자동 생성
# ==============================================================================

source "$(dirname "$0")/utils.sh"

FEATURE="$1"
PROVIDER="${AI_PROVIDER:-openai}"

if [ -z "$FEATURE" ]; then
  echo "❌ 사용법: bash scripts/decompose-task.sh \"구현할 기능 설명\""
  exit 1
fi

# ── 컨텍스트 수집 ──────────────────────────────────────────────────────────────
AGENTS_CONTENT=$(cat AGENTS.md 2>/dev/null || echo "")
PLANS_CONTENT=$(cat docs/project/PLANS.md 2>/dev/null || echo "")

SYSTEM_PROMPT="당신은 시니어 소프트웨어 아키텍트입니다.
주어진 기능 설명을 독립적으로 구현 가능한 작은 태스크들로 분해하세요.

=== 프로젝트 컨텍스트 ===
${PLANS_CONTENT}

=== 코딩 규칙 ===
${AGENTS_CONTENT}

분해 규칙:
1. 각 태스크는 1~2일 내에 완료 가능한 크기
2. 태스크 간 의존성을 고려하여 순서 정렬 (선행 태스크 먼저)
3. 태스크 이름은 kebab-case (예: ad-domain-model)
4. 타입은 feat, fix, refactor, test, docs 중 하나
5. 반드시 아래 JSON 형식으로만 응답 (설명 텍스트 없이)

응답 형식:
{
  \"feature\": \"기능 요약\",
  \"tasks\": [
    {
      \"order\": 1,
      \"name\": \"task-name\",
      \"type\": \"feat\",
      \"description\": \"이 태스크에서 구현할 내용\",
      \"depends_on\": []
    }
  ]
}"

USER_PROMPT="다음 기능을 태스크로 분해해줘: ${FEATURE}"

echo "🔍 [Harness] 태스크 분해 중..."
echo "   기능: $FEATURE"
echo "   Provider: $PROVIDER"
echo "─────────────────────────────────────────────────────────"

# ── API 호출 (architect 모델 사용) ─────────────────────────────────────────────
call_api() {
  case "$PROVIDER" in
    openai)
      [ -z "$OPENAI_API_KEY" ] && echo "❌ OPENAI_API_KEY 미설정" && exit 1
      MODEL="${OPENAI_MODEL_STRONG:-gpt-5.5-pro}"
      curl -s https://api.openai.com/v1/chat/completions \
        -H "Content-Type: application/json" \
        -H "Authorization: Bearer $OPENAI_API_KEY" \
        -d "{
          \"model\": \"$MODEL\",
          \"messages\": [
            {\"role\": \"system\", \"content\": $(echo "$SYSTEM_PROMPT" | jq -Rs .)},
            {\"role\": \"user\", \"content\": $(echo "$USER_PROMPT" | jq -Rs .)}
          ],
          \"response_format\": {\"type\": \"json_object\"}
        }" | jq -r '.choices[0].message.content'
      ;;
    anthropic)
      [ -z "$ANTHROPIC_API_KEY" ] && echo "❌ ANTHROPIC_API_KEY 미설정" && exit 1
      MODEL="${ANTHROPIC_MODEL_STRONG:-claude-opus-4-7}"
      curl -s https://api.anthropic.com/v1/messages \
        -H "Content-Type: application/json" \
        -H "x-api-key: $ANTHROPIC_API_KEY" \
        -H "anthropic-version: 2023-06-01" \
        -d "{
          \"model\": \"$MODEL\",
          \"max_tokens\": 4096,
          \"system\": $(echo "$SYSTEM_PROMPT" | jq -Rs .),
          \"messages\": [{\"role\": \"user\", \"content\": $(echo "$USER_PROMPT" | jq -Rs .)}]
        }" | jq -r '.content[0].text'
      ;;
    gemini)
      [ -z "$GEMINI_API_KEY" ] && echo "❌ GEMINI_API_KEY 미설정" && exit 1
      MODEL="${GEMINI_MODEL_STRONG:-gemini-3-1-pro}"
      FULL="${SYSTEM_PROMPT}\n\n${USER_PROMPT}"
      curl -s "https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=$GEMINI_API_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"contents\": [{\"parts\": [{\"text\": $(echo "$FULL" | jq -Rs .)}]}],
             \"generationConfig\": {\"responseMimeType\": \"application/json\"}}" \
        | jq -r '.candidates[0].content.parts[0].text'
      ;;
    *)
      echo "❌ 지원하지 않는 provider: $PROVIDER"
      exit 1
      ;;
  esac
}

# ── 응답 파싱 및 출력 ──────────────────────────────────────────────────────────
RESPONSE=$(call_api)

if ! echo "$RESPONSE" | jq . > /dev/null 2>&1; then
  echo "❌ AI 응답 파싱 실패. 응답:"
  echo "$RESPONSE"
  exit 1
fi

FEATURE_SUMMARY=$(echo "$RESPONSE" | jq -r '.feature')
TASK_COUNT=$(echo "$RESPONSE" | jq '.tasks | length')

echo ""
echo "📋 기능: $FEATURE_SUMMARY"
echo "   총 태스크: ${TASK_COUNT}개"
echo ""

# 태스크 목록 출력
echo "$RESPONSE" | jq -r '.tasks[] | "  [\(.order)] \(.type)/\(.name)\n      └ \(.description)"'

echo ""
echo "─────────────────────────────────────────────────────────"

# ── 워크트리 생성 여부 확인 ────────────────────────────────────────────────────
read -p "▶ 위 태스크의 워크트리를 모두 생성할까요? (y/n): " CONFIRM

if [ "$CONFIRM" = "y" ] || [ "$CONFIRM" = "Y" ]; then
  echo ""
  echo "🚀 워크트리 생성 시작..."

  echo "$RESPONSE" | jq -c '.tasks[]' | while read -r task; do
    NAME=$(echo "$task" | jq -r '.name')
    TYPE=$(echo "$task" | jq -r '.type')
    DESC=$(echo "$task" | jq -r '.description')

    echo ""
    echo "  ▶ 생성 중: $TYPE/$NAME"
    bash scripts/start-task.sh "$NAME" "$TYPE"

    # EXEC_PLAN에 AI가 생성한 설명 추가
    PLAN_FILE=".harness/tasks/active/${NAME}.md"
    if [ -f "$PLAN_FILE" ]; then
      sed -i "s/\[여기에 목표 작성\]/$DESC/" "$PLAN_FILE" 2>/dev/null || true
    fi
  done

  echo ""
  echo "✅ 모든 워크트리 생성 완료."
  echo ""
  echo "📌 작업 순서:"
  echo "$RESPONSE" | jq -r '.tasks[] | "  \(.order). cd .worktrees/\(.name) && bash scripts/verify-task.sh"'

  send_slack_notification "success" "🔀 [$FEATURE_SUMMARY] ${TASK_COUNT}개 태스크로 분해 완료"
else
  echo "ℹ️  워크트리 생성 건너뜀. 수동으로 실행하려면:"
  echo ""
  echo "$RESPONSE" | jq -r '.tasks[] | "  bash scripts/start-task.sh \(.name) \(.type)"'
fi
