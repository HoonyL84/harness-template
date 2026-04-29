#!/bin/bash
# ============================================================================
# Validate memory frontmatter format.
# ============================================================================

set -u

FAILED=0

check_file() {
  local file="$1"
  if [ ! -f "$file" ]; then
    return 0
  fi

  if ! grep -q "^---$" "$file"; then
    echo "[WARN] No frontmatter delimiter: $file"
    return 0
  fi

  local fm
  fm=$(awk 'BEGIN{c=0} /^---$/{c++; if(c==2) exit} c==1{print}' "$file")

  echo "$fm" | grep -q "^layer:" || { echo "[FAIL] Missing layer in $file"; FAILED=$((FAILED+1)); }
  echo "$fm" | grep -q "^title:" || { echo "[FAIL] Missing title in $file"; FAILED=$((FAILED+1)); }
  echo "$fm" | grep -q "^updated_at:" || { echo "[FAIL] Missing updated_at in $file"; FAILED=$((FAILED+1)); }
}

for dir in memory/working memory/semantic memory/episodic memory/procedural; do
  if [ -d "$dir" ]; then
    while IFS= read -r file; do
      check_file "$file"
    done < <(find "$dir" -maxdepth 1 -type f -name "*.md" ! -name "README.md" 2>/dev/null)
  fi
done

if [ "$FAILED" -gt 0 ]; then
  echo "Memory validation failed: $FAILED"
  exit 1
fi

echo "Memory validation passed"
exit 0
