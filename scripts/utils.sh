#!/bin/bash
# ==============================================================================
# [Harness] 공통 유틸리티
# ==============================================================================

# .env.local 로드
if [ -f ".env.local" ]; then
  export $(grep -v '^#' .env.local | xargs)
fi

send_slack_notification() {
  local status=$1
  local message=$2
  local task_id=${TASK_ID:-"unknown"}

  if [ -z "$SLACK_WEBHOOK_URL" ] || [[ "$SLACK_WEBHOOK_URL" == *"YOUR/WEBHOOK/URL"* ]]; then
    echo "  [Slack] 웹훅 미설정 — 알림 생략"
    return 0
  fi

  local color="#36a64f"
  if [ "$status" == "fail" ]; then color="#ff0000"; fi

  local payload=$(cat <<EOF
{
  "attachments": [{
    "fallback": "Harness: $message",
    "color": "$color",
    "title": "[Harness] Task: $task_id",
    "text": "$message",
    "footer": "Harness Engineering",
    "ts": $(date +%s)
  }]
}
EOF
)
  curl -s -X POST -H 'Content-type: application/json' --data "$payload" "$SLACK_WEBHOOK_URL" > /dev/null
}
