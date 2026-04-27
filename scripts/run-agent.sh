#!/bin/bash
# ==============================================================================
# [Harness] 범용 AI 에이전트 트리거 (모델 라우팅 포함)
#
# Usage:
#   bash scripts/run-agent.sh [--type <task-type>] "태스크 설명"
#
# Task Types:
#   --type code       단순 코드 생성/수정  → 빠르고 저렴한 모델
#   --type architect  아키텍처/설계 결정  → 강력한 추론 모델
#   --type review     코드 리뷰           → 균형 모델
#   --type docs       문서 작성           → 저렴한 모델
#   (기본값)          일반 작업           → 균형 모델
#
# AI_PROVIDER: openai | anthropic | gemini  (기본값: openai)
# ==============================================================================

source "$(dirname "$0")/utils.sh"

# ── 인자 파싱 ──────────────────────────────────────────────────────────────────
TASK_TYPE="default"
TASK_PROMPT=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --type)
      TASK_TYPE="$2"
      shift 2
      ;;
    *)
      TASK_PROMPT="$1"
      shift
      ;;
  esac
done

PROVIDER="${AI_PROVIDER:-openai}"

if [ -z "$TASK_PROMPT" ]; then
  echo "❌ 사용법: bash scripts/run-agent.sh [--type code|architect|review|docs] \"태스크 설명\""
  echo ""
  echo "  --type code       단순 코드 생성/수정 (빠름, 저렴)"
  echo "  --type architect  아키텍처/설계 (강력한 추론)"
  echo "  --type review     코드 리뷰 (균형)"
  echo "  --type docs       문서 작성 (저렴)"
  exit 1
fi

# ── 모델 라우팅 ────────────────────────────────────────────────────────────────
#
# 비용/성능 트레이드오프 전략:
#   code     → 빠르고 저렴. 단순 CRUD, 보일러플레이트
#   docs     → 빠르고 저렴. 창의성보다 정확성
#   review   → 균형. 코드 이해력 + 적당한 속도
#   architect → 가장 강력. 복잡한 추론, 트레이드오프 분석
#
select_model() {
  local provider=$1
  local type=$2

  case "$provider" in
    openai)
      case "$type" in
        code|docs) echo "${OPENAI_MODEL_FAST:-gpt-5.5}" ;;
        architect) echo "${OPENAI_MODEL_STRONG:-gpt-5.5-pro}" ;;
        review|default|*) echo "${OPENAI_MODEL:-gpt-5.5}" ;;
      esac
      ;;
    anthropic)
      case "$type" in
        code|docs) echo "${ANTHROPIC_MODEL_FAST:-claude-haiku-4-5}" ;;
        architect) echo "${ANTHROPIC_MODEL_STRONG:-claude-opus-4-7}" ;;
        review|default|*) echo "${ANTHROPIC_MODEL:-claude-sonnet-4-6}" ;;
      esac
      ;;
    gemini)
      case "$type" in
        code|docs) echo "${GEMINI_MODEL_FAST:-gemini-3-flash}" ;;
        architect) echo "${GEMINI_MODEL_STRONG:-gemini-3-1-pro}" ;;
        review|default|*) echo "${GEMINI_MODEL:-gemini-3-flash}" ;;
      esac
      ;;
  esac
}

SELECTED_MODEL=$(select_model "$PROVIDER" "$TASK_TYPE")

# ── 컨텍스트 수집 ──────────────────────────────────────────────────────────────
AGENTS_CONTENT=$(cat AGENTS.md 2>/dev/null || echo "AGENTS.md 없음")
PLANS_CONTENT=$(cat docs/project/PLANS.md 2>/dev/null || echo "PLANS.md 없음")

SYSTEM_PROMPT="당신은 하네스(Harness Engineering) 원칙을 따르는 시니어 소프트웨어 엔지니어입니다.
아래 규칙과 프로젝트 컨텍스트를 읽고 주어진 태스크를 수행하세요.

=== AGENTS.md (행동 강령) ===
${AGENTS_CONTENT}

=== PLANS.md (프로젝트 목표 및 스택) ===
${PLANS_CONTENT}

현재 태스크 유형: ${TASK_TYPE}
규칙:
1. 코드 작성 시 AGENTS.md의 코딩 규칙을 엄격히 따르세요.
2. 불확실한 부분은 추측하지 말고 가정(Assumption)을 명시하세요.
3. 구현 완료 후 검증 방법을 함께 제시하세요."

echo "🤖 [Harness Agent]"
echo "   Provider : $PROVIDER"
echo "   Model    : $SELECTED_MODEL  (task-type: $TASK_TYPE)"
echo "   Task     : $TASK_PROMPT"
echo "─────────────────────────────────────────────────────────"

# ── API 호출 ──────────────────────────────────────────────────────────────────

call_openai() {
  [ -z "$OPENAI_API_KEY" ] && echo "❌ OPENAI_API_KEY 미설정" && exit 1
  curl -s https://api.openai.com/v1/chat/completions \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -d "{
      \"model\": \"$SELECTED_MODEL\",
      \"messages\": [
        {\"role\": \"system\", \"content\": $(echo "$SYSTEM_PROMPT" | jq -Rs .)},
        {\"role\": \"user\",   \"content\": $(echo "$TASK_PROMPT"   | jq -Rs .)}
      ]
    }" | jq -r '.choices[0].message.content'
}

call_anthropic() {
  [ -z "$ANTHROPIC_API_KEY" ] && echo "❌ ANTHROPIC_API_KEY 미설정" && exit 1
  curl -s https://api.anthropic.com/v1/messages \
    -H "Content-Type: application/json" \
    -H "x-api-key: $ANTHROPIC_API_KEY" \
    -H "anthropic-version: 2023-06-01" \
    -d "{
      \"model\": \"$SELECTED_MODEL\",
      \"max_tokens\": 8192,
      \"system\": $(echo "$SYSTEM_PROMPT" | jq -Rs .),
      \"messages\": [{\"role\": \"user\", \"content\": $(echo "$TASK_PROMPT" | jq -Rs .)}]
    }" | jq -r '.content[0].text'
}

call_gemini() {
  [ -z "$GEMINI_API_KEY" ] && echo "❌ GEMINI_API_KEY 미설정" && exit 1
  FULL_PROMPT="${SYSTEM_PROMPT}\n\n---\n\n${TASK_PROMPT}"
  curl -s "https://generativelanguage.googleapis.com/v1beta/models/${SELECTED_MODEL}:generateContent?key=$GEMINI_API_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"contents\": [{\"parts\": [{\"text\": $(echo "$FULL_PROMPT" | jq -Rs .)}]}]}" \
    | jq -r '.candidates[0].content.parts[0].text'
}

# ── Provider 분기 ──────────────────────────────────────────────────────────────
case "$PROVIDER" in
  openai)    call_openai ;;
  anthropic) call_anthropic ;;
  gemini)    call_gemini ;;
  *) echo "❌ 지원하지 않는 provider: $PROVIDER"; exit 1 ;;
esac

echo ""
echo "─────────────────────────────────────────────────────────"
echo "✅ 완료 | $PROVIDER / $SELECTED_MODEL"
send_slack_notification "success" "🤖 [$TASK_TYPE] 완료: $TASK_PROMPT ($SELECTED_MODEL)"
