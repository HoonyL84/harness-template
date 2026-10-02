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

새 작업은 최신 main에서 티켓 단위 `codex/` 브랜치로 시작한다. 관리형 실행의 worktree 격리는 유지한다.

## 릴리스 게이트

- main에는 직접 push하지 않는다. 작업 브랜치를 push하고 PR을 생성한다.
- 최종 커밋에서 로컬 Full 검증과 최신 PR의 필수 3개 OS CI, Release Gate, 보안 검사가 모두 통과해야 한다.
- 체크 통과 후에도 사용자 명시 승인 전에는 병합하지 않는다.
- squash 또는 rebase로 병합한 후 로컬 main을 fast-forward 갱신한다.
- 실패, 취소, 미실행 필수 검증은 성공이 아니다. `--admin`이나 보호 설정 해제로 우회하지 않는다.
- 상세 범위와 서버 설정은 [릴리스 안전 정책](../RELEASE_SAFETY.md)을 따른다.

---

## PR 체크리스트

PR 머지 전:
- [ ] `verify-task.sh` 통과
- [ ] PR 설명에 변경 내용/이유/테스트 방법 작성
- [ ] Self-review 체크리스트 완료
- [ ] CI 통과 (GitHub Actions)
