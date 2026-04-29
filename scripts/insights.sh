#!/bin/bash
# ==============================================================================
# [Harness] 인사이트 리포트 — observability/metrics/*.done.json 기반 통계 출력
# Usage: bash scripts/insights.sh
# ==============================================================================

LOG_DIR="observability/metrics"
DONE_FILES=("$LOG_DIR"/*.done.json)

if [ ! -f "${DONE_FILES[0]}" ]; then
  echo "📭 완료된 태스크 로그가 없습니다. (${LOG_DIR}/*.done.json)"
  exit 0
fi

echo ""
echo "══════════════════════════════════════════════════"
echo "  📊 Harness Engineering Insights"
echo "  프로젝트: $(basename $(git rev-parse --show-toplevel 2>/dev/null || echo 'unknown'))"
echo "══════════════════════════════════════════════════"

TOTAL=0
FEAT=0; FIX=0; REFACTOR=0; OTHER=0
TOTAL_REWORK=0
HIGH_REWORK_TASKS=""

for f in "${DONE_FILES[@]}"; do
  [ -f "$f" ] || continue

  TASK=$(grep -o '"task":"[^"]*"' "$f" | cut -d'"' -f4)
  TYPE=$(grep -o '"type":"[^"]*"' "$f" | cut -d'"' -f4)
  STARTED=$(grep -o '"started_at":"[^"]*"' "$f" | cut -d'"' -f4)
  COMPLETED=$(grep -o '"completed_at":"[^"]*"' "$f" | cut -d'"' -f4)
  REWORK=$(grep -o '"rework_count":[0-9]*' "$f" | grep -o '[0-9]*')
  FAIL_REASON=$(grep -o '"last_fail_reason":"[^"]*"' "$f" | cut -d'"' -f4)

  REWORK=${REWORK:-0}
  TOTAL=$((TOTAL + 1))
  TOTAL_REWORK=$((TOTAL_REWORK + REWORK))

  case "$TYPE" in
    feat)     FEAT=$((FEAT + 1)) ;;
    fix)      FIX=$((FIX + 1)) ;;
    refactor) REFACTOR=$((REFACTOR + 1)) ;;
    *)        OTHER=$((OTHER + 1)) ;;
  esac

  # 소요시간 계산 (초)
  DURATION="측정불가"
  if command -v python3 &>/dev/null && [ "$STARTED" != "unknown" ]; then
    SECS=$(python3 -c "
from datetime import datetime
try:
    s = datetime.strptime('$STARTED', '%Y-%m-%dT%H:%M:%SZ')
    e = datetime.strptime('$COMPLETED', '%Y-%m-%dT%H:%M:%SZ')
    d = int((e-s).total_seconds())
    h, r = divmod(d, 3600)
    m, s = divmod(r, 60)
    print(f'{h}h {m}m {s}s' if h > 0 else f'{m}m {s}s')
except: print('측정불가')
" 2>/dev/null)
    DURATION="$SECS"
  fi

  # rework 2회 이상이면 표시
  if [ "$REWORK" -ge 2 ]; then
    HIGH_REWORK_TASKS="${HIGH_REWORK_TASKS}  ⚠️  ${TASK} (rework: ${REWORK}회, 마지막 실패: ${FAIL_REASON})\n"
  fi

  echo ""
  echo "  [${TYPE}] ${TASK}"
  echo "    소요시간 : ${DURATION}"
  echo "    재작업   : ${REWORK}회  $([ "$REWORK" -eq 0 ] && echo '✅' || echo '⚠️')"
  [ "$REWORK" -gt 0 ] && echo "    실패원인 : ${FAIL_REASON}"
done

# ── 요약 ─────────────────────────────────────────────────────────────────────
AVG_REWORK=0
if [ "$TOTAL" -gt 0 ]; then
  AVG_REWORK=$(echo "scale=1; $TOTAL_REWORK / $TOTAL" | bc 2>/dev/null || echo "$TOTAL_REWORK/$TOTAL")
fi

echo ""
echo "══════════════════════════════════════════════════"
echo "  요약"
echo "  총 완료 태스크 : ${TOTAL}개"
echo "  유형 분포      : feat=${FEAT} / fix=${FIX} / refactor=${REFACTOR} / other=${OTHER}"
echo "  총 재작업 횟수 : ${TOTAL_REWORK}회 (평균 ${AVG_REWORK}회/태스크)"
echo "══════════════════════════════════════════════════"

if [ -n "$HIGH_REWORK_TASKS" ]; then
  echo ""
  echo "  🔴 재작업 2회 이상 태스크 (개선 포인트):"
  echo -e "$HIGH_REWORK_TASKS"
fi
echo ""
