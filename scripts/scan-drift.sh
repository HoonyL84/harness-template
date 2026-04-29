#!/bin/bash
# ==============================================================================
# [Harness] P7: Garbage Collection — 코드/문서 drift 자동 감지
#
# Usage: bash scripts/scan-drift.sh
#
# 감지 항목:
#   1. Doc Drift   — 최근 변경된 코드가 문서에 반영되었는가?
#   2. Config Drift — .env.template에 없는 환경 변수가 코드에 있는가?
#   3. Task Drift   — 14일 이상 방치된 active 태스크
#   4. Log Drift    — observability/traces/가 과도하게 쌓였는가? (100개 초과)
# ==============================================================================

source "$(dirname "$0")/utils.sh"

DRIFT_FOUND=0
REPORT=""

echo "🔍 [Harness GC] Drift 스캔 시작..."
echo "═══════════════════════════════════════════════════════"

# ── 1. Task Drift: 오래된 active 태스크 감지 ──────────────────────────────────
echo "▶ [1/4] Task Drift 검사..."
ACTIVE_DIR=".harness/tasks/active"
if [ -d "$ACTIVE_DIR" ]; then
  OLD_TASKS=$(find "$ACTIVE_DIR" -name "*.md" -mtime +14 2>/dev/null)
  if [ -n "$OLD_TASKS" ]; then
    DRIFT_FOUND=1
    REPORT="${REPORT}\n⚠️  [Task Drift] 14일 이상 방치된 태스크:\n${OLD_TASKS}\n"
    echo "  ⚠️  오래된 태스크 발견: $(echo "$OLD_TASKS" | wc -l)개"
  else
    echo "  ✅ 이상 없음"
  fi
fi

# ── 2. Log Drift: 로그 파일 과적 감지 ──────────────────────────────────────────
echo "▶ [2/4] Log Drift 검사..."
LOG_DIR="observability/traces"
if [ -d "$LOG_DIR" ]; then
  LOG_COUNT=$(find "$LOG_DIR" -name "*.log" 2>/dev/null | wc -l)
  if [ "$LOG_COUNT" -gt 100 ]; then
    DRIFT_FOUND=1
    REPORT="${REPORT}\n⚠️  [Log Drift] 로그 파일이 ${LOG_COUNT}개 — 정리 필요 (임계값: 100개)\n"
    echo "  ⚠️  로그 과적: ${LOG_COUNT}개"
  else
    echo "  ✅ 로그 ${LOG_COUNT}개 — 이상 없음"
  fi
fi

# ── 3. Config Drift: 코드에서 쓰는 환경 변수가 .env.template에 있는가? ──────────
echo "▶ [3/4] Config Drift 검사..."
if [ -f ".env.template" ]; then
  # 코드에서 process.env 또는 System.getenv 패턴 수집
  CODE_VARS=$(grep -rh --include="*.java" --include="*.js" --include="*.ts" \
    -oP '(?<=System\.getenv\(")[^"]+|(?<=process\.env\.)[A-Z_]+' . 2>/dev/null | sort -u)
  TEMPLATE_VARS=$(grep -oP '^[A-Z_]+(?==)' .env.template 2>/dev/null | sort -u)
  MISSING=$(comm -23 <(echo "$CODE_VARS") <(echo "$TEMPLATE_VARS") 2>/dev/null)
  if [ -n "$MISSING" ]; then
    DRIFT_FOUND=1
    REPORT="${REPORT}\n⚠️  [Config Drift] .env.template에 없는 환경 변수:\n${MISSING}\n"
    echo "  ⚠️  누락된 env 변수 발견"
  else
    echo "  ✅ 이상 없음"
  fi
fi

# ── 4. Archive Drift: archive에 너무 많이 쌓인 경우 ───────────────────────────
echo "▶ [4/4] Archive 정리 안내..."
ARCHIVE_DIR=".harness/tasks/archive"
if [ -d "$ARCHIVE_DIR" ]; then
  ARCHIVE_COUNT=$(find "$ARCHIVE_DIR" -name "*.md" 2>/dev/null | wc -l)
  if [ "$ARCHIVE_COUNT" -gt 50 ]; then
    REPORT="${REPORT}\nℹ️  [Archive] 완료 태스크 ${ARCHIVE_COUNT}개 — 분기별 정리 권장\n"
    echo "  ℹ️  Archive ${ARCHIVE_COUNT}개 — 분기별 정리 권장"
  else
    echo "  ✅ Archive ${ARCHIVE_COUNT}개 — 이상 없음"
  fi
fi

# ── 결과 출력 ──────────────────────────────────────────────────────────────────
echo "═══════════════════════════════════════════════════════"

if [ "$DRIFT_FOUND" -eq 1 ]; then
  echo -e "\n$REPORT"
  send_slack_notification "fail" "⚠️ [Harness GC] Drift 감지됨. 로그를 확인하세요."
  echo "⚠️  Drift 감지됨. 위 내용을 확인하고 정리하세요."
  exit 1
else
  echo "✅ 모든 항목 이상 없음. Drift 없음."
  send_slack_notification "success" "✅ [Harness GC] Drift 없음 — 코드베이스 건강"
fi
