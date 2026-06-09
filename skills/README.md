# Skills Directory Standard

각 스킬은 아래 구조를 따릅니다.

```text
skills/
  <skill_name>/
    SKILL.md
    examples.jsonl
    allowlist.yaml
```

- `SKILL.md`: 언제/어떻게 스킬을 호출할지. YAML frontmatter에 `name`과 `description`을 포함합니다.
- `examples.jsonl`: 골든 호출 예시(평가/회귀 테스트용)
- `allowlist.yaml`: 어떤 에이전트/역할이 사용 가능한지

권장 frontmatter:

```yaml
---
name: skill-name
description: When an agent should use this skill and what outcome it produces.
version: 1.0.0
tags:
  - review
platforms:
  - codex
  - claude-code
  - github-copilot
---
```
