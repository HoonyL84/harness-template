#!/bin/bash
# ==============================================================================
# [Harness] 범용 AI 에이전트 트리거
# AGENTS.md + PLANS.md 를 컨텍스트로 AI API를 호출한다.
#
# Usage:
#   bash scripts/run-agent.sh "Task 1 구현해줘"
#
# 환경변수 (AI_PROVIDER 로 선택):
#   AI_PROVIDER=openai    → OPENAI_API_KEY 필요
#   AI_PROVIDER=anthropic → ANTHROPIC_API_KEY 필요
#   AI_PROVIDER=gemini    → GEMINI_API_KEY 필요
# ==============================================================================

source "$(dirname "$0")/utils.sh"

TASK_PROMPT="$1"
PROVIDER="${AI_PROVIDER:-openai}"

if [ -z "$TASK_PROMPT" ]; then
  echo "❌ 사용법: bash scripts/run-agent.sh \"태스크 설명\""
  exit 1
fi

# ── 컨텍스트 수집 ──────────────────────────────────────────────────────────────
AGENTS_CONTENT=$(cat AGENTS.md 2>/dev/null || echo "AGENTS.md 없음")
PLANS_CONTENT=$(cat docs/project/PLANS.md 2>/dev/null || echo "PLANS.md 없음")

SYSTEM_PROMPT="당신은 하네스(Harness Engineering) 원칙을 따르는 시니어 소프트웨어 엔지니어입니다.
아래 규칙과 프로젝트 컨텍스트를 읽고 주어진 태스크를 수행하세요.

=== AGENTS.md (행동 강령) ===
${AGENTS_CONTENT}

=== PLANS.md (프로젝트 목표 및 스택) ===
${PLANS_CONTENT}

규칙:
1. 코드를 작성할 때는 AGENTS.md의 코딩 규칙을 엄격히 따르세요.
2. 불확실한 부분은 추측하지 말고 명시적으로 가정(Assumption)을 밝히세요.
3. 구현 완료 후 검증 방법을 함께 제시하세요."

USER_PROMPT="$TASK_PROMPT"

echo "🤖 [Harness Agent] Provider: $PROVIDER"
echo "📋 Task: $TASK_PROMPT"
echo "─────────────────────────────────────────"

# ── API 호출 ──────────────────────────────────────────────────────────────────

call_openai() {
  if [ -z "$OPENAI_API_KEY" ]; then echo "❌ OPENAI_API_KEY 미설정"; exit 1; fi
  RESPONSE=$(curl -s https://api.openai.com/v1/chat/completions \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -d "{
      \"model\": \"${OPENAI_MODEL:-gpt-4o}\",
      \"messages\": [
        {\"role\": \"system\", \"content\": $(echo "$SYSTEM_PROMPT" | jq -Rs .)},
        {\"role\": \"user\", \"content\": $(echo "$USER_PROMPT" | jq -Rs .)}
      ]
    }")
  echo "$RESPONSE" | jq -r '.choices[0].message.content'
}

call_anthropic() {
  if [ -z "$ANTHROPIC_API_KEY" ]; then echo "❌ ANTHROPIC_API_KEY 미설정"; exit 1; fi
  RESPONSE=$(curl -s https://api.anthropic.com/v1/messages \
    -H "Content-Type: application/json" \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -d "{
      \"model\": \"${ANTHROPIC_MODEL:-claude-opus-4-5}\",
      \"max_tokens\": 8192,
      \"system\": $(echo "$SYSTEM_PROMPT" | jq -Rs .),
      \"messages\": [
        {\"role\": \"user\", \"content\": $(echo "$USER_PROMPT" | jq -Rs .)}
      ]
    }")
  echo "$RESPONSE" | jq -r '.content[0].text'
}

call_gemini() {
  if [ -z "$GEMINI_API_KEY" ]; then echo "❌ GEMINI_API_KEY 미설정"; exit 1; fi
  FULL_PROMPT="${SYSTEM_PROMPT}\n\n---\n\n${USER_PROMPT}"
  RESPONSE=$(curl -s "https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL:-gemini-2.0-flash}:generateContent?key=$GEMINI_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"contents\": [{
        \"parts\": [{\"text\": $(echo "$FULL_PROMPT" | jq -Rs .)}]
      }]
    }")
  echo "$RESPONSE" | jq -r '.candidates[0].content.parts[0].text'
}

# ── Provider 분기 ──────────────────────────────────────────────────────────────
case "$PROVIDER" in
  openai)    call_openai ;;
  anthropic) call_anthropic ;;
  gemini)    call_gemini ;;
  *)
    echo "❌ 지원하지 않는 provider: $PROVIDER (openai | anthropic | gemini)"
    exit 1
    ;;
esac

echo ""
echo "─────────────────────────────────────────"
echo "✅ 에이전트 응답 완료"
send_slack_notification "success" "🤖 Agent 태스크 완료: $TASK_PROMPT"
