# Skills Directory Standard

각 스킬은 아래 구조를 따릅니다.

```text
skills/
  <skill_name>/
    SKILL.md
    examples.jsonl
    allowlist.yaml
```

- `SKILL.md`: 언제/어떻게 스킬을 호출할지
- `examples.jsonl`: 골든 호출 예시(평가/회귀 테스트용)
- `allowlist.yaml`: 어떤 에이전트/역할이 사용 가능한지
