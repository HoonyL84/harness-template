# Agent Roles

이 문서는 하네스 안에서 AI가 상황별로 어떤 역할을 수행해야 하는지 정의한다.

역할은 별도 프로세스가 아니라, `scripts/run-agent.sh --role <role>`로 주입되는 시스템 프롬프트 계약이다. 멀티에이전트 런타임을 도입하지 않아도 하나의 AI가 작업 단계마다 다른 책임을 수행할 수 있게 한다.

## 역할 목록

| Role | 책임 | 주요 입력 | 주요 출력 |
|------|------|-----------|-----------|
| `orchestrator` | 선택형 멀티에이전트 실행, artifact 정규화, 승인·통합 게이트 관리 | active EXEC_PLAN, adapter capability, role artifact | frozen plan, 실행 상태, 승인 요청, 통합 후보 |
| `planner` | 목표, 범위, 성공 기준 정리 | `PLANS.md`, active EXEC_PLAN | 단계별 계획, 가정, 완료 기준 |
| `architect` | 설계와 고위험 결정 검토 | design docs, ADR, tech stack | 선택지, 트레이드오프, 승인 필요 여부 |
| `implementer` | 최소 범위 코드 구현 | EXEC_PLAN, core beliefs, tech stack | 코드 변경, 검증 방법 |
| `reviewer` | 버그/회귀/테스트 누락 검토 | diff, 요구사항, 테스트 | severity 순 finding |
| `verifier` | 테스트/빌드/CI/보안 확인 | scripts, CI 결과, 로그 | 통과/실패 원인, 재시도 계획 |
| `recorder` | 작업 로그와 결과 기록 | traces, metrics, task context | 요약, changelog 후보, observability 기록 |
| `memory` | 장기 기억 갱신 판단 | memory governance, 반복 지식 | memory 업데이트 제안 |
| `release` | 커밋/PR/완료 처리 | git diff, verify 결과 | 커밋/PR 요약, 완료 체크리스트 |

## 기본 라우팅

`run-agent.sh`에서 `--role`을 생략하면 `--type`에 따라 기본 역할을 추론한다.

| Task Type | Default Role |
|-----------|--------------|
| `code` | `implementer` |
| `architect` | `architect` |
| `review` | `reviewer` |
| `docs` | `recorder` |
| `default` | `implementer` |

## 선택형 멀티에이전트 역할 계약

멀티에이전트 orchestration은 기본 비활성화다. 프로젝트 설정에서 활성화하고 `orchestrate`를 명시적으로 실행하지 않으면 기존처럼 하나의 에이전트가 역할을 순서대로 수행한다.

### Phase 1: 단일 writer

1. `planner`와 `architect`는 지원되는 환경에서 병렬로 분석할 수 있다.
2. `orchestrator`는 결과 artifact를 정규화하고 충돌하는 가정을 해결한 뒤 계획을 고정한다.
3. workspace를 수정하는 역할은 `implementer` 하나뿐이다.
4. `reviewer`와 `verifier`는 구현자와 분리하며, 서로 독립적인 검토는 병렬로 수행할 수 있다.
5. 병렬 실행을 지원하지 않는 환경에서는 같은 역할 그래프를 순차 실행하며 입력, 출력, 승인 경계는 바꾸지 않는다.

### Phase 2: 격리된 multi-writer

여러 `implementer`는 사용자가 명시적으로 opt-in하고 아래 조건을 모두 만족할 때만 병렬로 쓸 수 있다.

- 각 worker의 `owned_paths`가 서로 겹치지 않는다.
- 모든 worker가 같은 `base_commit`에서 시작한다.
- worker마다 별도 branch와 `.worktrees/orchestrate/<run-id>/` 아래의 격리 worktree를 사용한다.
- manifest, lockfile, DB migration, CI, scripts, 인프라, 보안 정책은 worker 소유 경로에서 제외한다.
- worker는 다른 worker의 branch, worktree, 소유 경로를 수정하지 않는다.
- worker별 review와 verification은 최종 통합 검증을 대체하지 않는다.

`orchestrator`만 실행 상태와 승인 상태를 전이할 수 있다. 하위 역할은 승인을 요청할 수 있지만 승인 완료로 표시하거나 자동 통합할 수 없다.

## 공통 Role Artifact

병렬, API, 순차 fallback은 모두 provider 고유 응답 대신 다음 공통 필드를 가진 artifact를 전달한다.

```json
{
  "schema_version": "1.0",
  "role": "planner",
  "status": "completed",
  "summary": "...",
  "assumptions": [],
  "findings": [],
  "proposed_actions": [],
  "owned_paths": [],
  "approval_required": false
}
```

일부 역할이 실패해도 완료된 artifact는 보존한다. 실패 역할만 정책이 허용하는 범위에서 재시도하며, stale base, 경로 소유권 위반, 검증 실패 또는 통합 충돌은 자동 통합하지 않는다.

## 승인 규칙

아래 상황은 역할과 무관하게 사용자의 명시 승인을 받아야 한다.

- DB 스키마 변경
- 인프라 또는 배포 설정 변경
- 인증/권한 정책 변경
- 보안 규칙 완화
- 비용이 발생하는 외부 API 추가
- 프로젝트 범위가 커지는 기능 추가
- 파일 삭제 또는 이름 변경
- worker 결과 통합, 커밋, push, PR merge
- 역할 사이에서 충돌하는 고위험 제안

승인 뒤 통합하더라도 통합 branch에서 `verify --full`을 통과하기 전에는 완료로 판정하거나 `complete-task`를 실행할 수 없다.

## 사용 예시

```bash
bash scripts/run-agent.sh --role planner "PLANS.md 기준으로 첫 태스크를 쪼개줘"
bash scripts/run-agent.sh --role architect --type architect "Redis 캐싱 전략을 검토해줘"
bash scripts/run-agent.sh --role reviewer --type review "현재 diff를 리뷰해줘"
bash scripts/run-agent.sh --role verifier "최근 CI 실패 원인을 정리해줘"
```
