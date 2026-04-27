# SKILL: Git 워크플로우 (Git Workflow)
# 이 스킬 파일은 에이전트가 커밋/PR 관련 작업을 수행할 때 읽는다.

---

## 커밋 메시지 형식

```
{type}({scope}): {요약}

{상세 설명 — 선택사항}
```

### 허용 타입

| type | 용도 |
|------|------|
| `feat` | 새 기능 |
| `fix` | 버그 수정 |
| `refactor` | 리팩토링 (동작 변경 없음) |
| `test` | 테스트 추가/수정 |
| `docs` | 문서/주석 |
| `chore` | 빌드, 의존성 |

### 좋은 예시

```
feat(budget): Redis Lua Script 기반 예산 원자 차감 구현

- DECRBY 대신 Lua Script 적용으로 Race Condition 방지
- TTL 30분 설정으로 Redis 메모리 누수 방지
```

### 나쁜 예시

```
수정함          ← type 없음
fix: 고침       ← scope 없음
feat(ad): 광고 서비스 전체 리팩토링 및 버그 수정 및 테스트 추가  ← 너무 많은 변경
```

---

## 브랜치 전략

- `master` — 항상 배포 가능한 상태 유지
- `feat/<task-name>` — 새 기능
- `fix/<task-name>` — 버그 수정
- `refactor/<task-name>` — 리팩토링

모든 브랜치는 `scripts/start-task.sh`로 생성 (워크트리 격리)

---

## PR 체크리스트

PR 머지 전:
- [ ] `verify-task.sh` 통과
- [ ] PR 설명에 변경 내용/이유/테스트 방법 작성
- [ ] Self-review 체크리스트 완료
- [ ] CI 통과 (GitHub Actions)
