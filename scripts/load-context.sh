#!/bin/bash
# ============================================================================
# [Harness] Context Loader
# Usage:
#   bash scripts/load-context.sh [--task-type <type>] [--task-name <name>]
# ============================================================================

TASK_TYPE="${CONTEXT_TASK_TYPE:-default}"
TASK_NAME="${CONTEXT_TASK_NAME:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --task-type)
      TASK_TYPE="$2"
      shift 2
      ;;
    --task-name)
      TASK_NAME="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

print_file_block() {
  local title="$1"
  local path="$2"
  local max_lines="$3"

  echo "=== ${title} (${path}) ==="
  if [ -f "$path" ]; then
    sed -n "1,${max_lines}p" "$path"
  else
    echo "[MISSING] $path"
  fi
  echo ""
}

print_dir_index() {
  local title="$1"
  local dir="$2"
  local max_files="$3"

  echo "=== ${title} (${dir}) ==="
  if [ -d "$dir" ]; then
    find "$dir" -maxdepth 1 -type f 2>/dev/null | sort | head -n "$max_files"
  else
    echo "[MISSING] $dir"
  fi
  echo ""
}

print_latest_file_block() {
  local title="$1"
  local dir="$2"
  local pattern="$3"
  local max_lines="$4"

  echo "=== ${title} (${dir}/${pattern}) ==="
  if [ -d "$dir" ]; then
    local latest
    latest=$(find "$dir" -maxdepth 1 -type f -name "$pattern" 2>/dev/null | sort | tail -n 1)
    if [ -n "$latest" ]; then
      echo "[LATEST] $latest"
      sed -n "1,${max_lines}p" "$latest"
    else
      echo "[EMPTY] no matching files"
    fi
  else
    echo "[MISSING] $dir"
  fi
  echo ""
}

echo "# Harness Context Bundle"
echo "GeneratedAt: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
echo "TaskType: ${TASK_TYPE}"
echo "TaskName: ${TASK_NAME:-unknown}"
echo ""

# Priority 1: global policy and goals
print_file_block "Agent Rules" "AGENTS.md" 300
print_file_block "Project Plan" "docs/project/PLANS.md" 250
print_file_block "Core Beliefs" "docs/design-docs/core-beliefs.md" 250
print_file_block "Tech Stack" "docs/design-docs/tech-stack.md" 200

# Priority 2: active task plan (if provided / infer by name)
if [ -n "$TASK_NAME" ]; then
  print_file_block "Active Task EXEC_PLAN" ".harness/tasks/active/${TASK_NAME}.md" 200
else
  print_latest_file_block "Latest Active Task EXEC_PLAN" ".harness/tasks/active" "*.md" 200
fi

# Priority 3: memory layers (index + light content)
print_dir_index "Working Memory Index" "memory/working" 20
print_dir_index "Semantic Memory Index" "memory/semantic" 20
print_dir_index "Episodic Memory Index" "memory/episodic" 20
print_dir_index "Procedural Memory Index" "memory/procedural" 20

print_latest_file_block "Latest Working Memory" "memory/working" "*.md" 120
print_latest_file_block "Latest Episodic Memory" "memory/episodic" "*.md" 120
print_latest_file_block "Latest Procedural Memory" "memory/procedural" "*.md" 120

# Priority 4: recent execution signals
print_latest_file_block "Latest Verify Metric" "observability/metrics" "*.verify.json" 120
print_latest_file_block "Latest Done Metric" "observability/metrics" "*.done.json" 120
