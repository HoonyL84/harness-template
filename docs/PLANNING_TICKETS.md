# 기획·기술 설계 티켓

중앙 하네스의 모든 프로젝트에서 공용으로 지원한다. 프로젝트별 기획 권한 모드나 추가 에이전트는 만들지 않는다. 사용자의 요청을 확인하고 초안을 승인받은 뒤 필요한 종류의 티켓만 사용한다.

## 종류와 완료 경계

| ticket_kind | 작업 | 검토 준비 조건 |
| --- | --- | --- |
| development | 기능 구현·버그 수정 | 승인된 전체 검증 명령 통과와 현재 콘텐츠 지문 |
| planning | 제품 컨셉·기능·사용자 경험 기획 | 승인된 문서·체크리스트 구조 검사와 현재 콘텐츠 지문 |
| design | 기술 구조·대안·트레이드오프 설계 | 승인된 문서·체크리스트 구조 검사와 현재 콘텐츠 지문 |

종류를 생략한 신규/기존 티켓은 development다. 기존 승인 계획의 지문을 다시 계산하거나 자동 변경하지 않는다. legacy create-ticket의 feat/fix/docs 등은 Git 작업 분류이며 중앙 ticket_kind와 다르다. legacy complete-task와 L5의 Full 게이트는 그대로 유지한다.

기획·설계 문서 구조 통과는 정답 판정이나 사용자 수락이 아니다. REVIEW_READY로 이동한 뒤 사용자 검수를 받아 history review로 accepted 또는 changes-requested를 기록한다. Jira 완료는 사용자 수락을 뜻하며 commit/push/deploy와 별개다. Git 반영은 별도의 기존 승인 게이트를 유지한다.

## 승인할 티켓 초안

request create/revise의 plan-file에서 다음 필드를 사용한다. 먼저 사용자에게 목표·범위·산출물·수용 기준·검수 방법·재시도 한도를 보여주고 승인받는다.

~~~json
{
  "goal": "게임 컨셉 후보를 비교한다",
  "tickets": [{
    "ticket_id": "concept-options",
    "project_id": "steam-project",
    "ticket_kind": "planning",
    "goal": "게임 컨셉 후보 비교",
    "scope": ["후보와 트레이드오프 정리"],
    "exclusions": ["코드 구현", "컨셉 임의 확정"],
    "deliverables": ["docs/concept-options.md"],
    "acceptance_criteria": ["후보별 제작 범위와 장단점을 비교한다"],
    "implementation_steps": ["기존 맥락 확인", "대안과 미결정 사항 정리"],
    "test_plan": {"manual": ["사용자가 후보와 제작 범위를 검수한다"]},
    "retry_policy": {"max_attempts": 3, "stop_on_same_error": true}
  }]
}
~~~

## 산출물 계약

- 승인된 docs/ 아래 Markdown 경로만 변경 가능하다. 최대 10개, 전체 UTF-8 크기 16KB이며 경로는 ASCII 이름을 사용한다.
- 모든 문서에 비어 있지 않은 Decisions, Open Questions, Acceptance Review 섹션을 작성한다. 헤더는 아래 형태로 고정하고 본문은 한국어로 작성할 수 있다.
- 승인된 수용 기준 문구를 문서에 포함한다. 체크리스트의 존재를 검사할 뿐 충족 여부를 AI가 확정하지 않는다.
- 미결정 사항은 숨기지 않는다. 없으면 명시적으로 없음이라고 작성한다.
- 코드·승인 밖 문서·삭제·symlink/junction 경로 변경은 검토 준비를 차단한다. 코드가 필요해졌다면 development 티켓으로 범위를 다시 승인받고 Full 검증한다.
- 문서 경로·내용·검증 스냅샷이 바뀌면 재검증/재검수가 필요하다. 문서 본문은 원격 게시 전에도 원본과 대조한다.

~~~markdown
# 컨셉 후보 비교

## Decisions
아직 최종 확정하지 않았으며 후보별 장단점을 정리했다.

## Open Questions
어떤 후보로 진행할지는 사용자 결정이 필요하다.

## Acceptance Review
- [ ] 후보별 제작 범위와 장단점을 비교한다
~~~

## 실행과 기록

1. 기존 project onboard와 request 승인 후 execution prepare로 격리 worktree를 준비한다.
2. 대화형 작업은 승인 문서만 작성한 뒤 execution review-ready를 실행한다. API runner는 planner/architect 역할로 문서 unified diff를 생성하며 기존 재시도·원복·알림 경계를 재사용한다.
3. 문서 티켓은 프로젝트 기본 빌드 명령을 자동 상속하지 않는다. 필요하면 verification에 승인된 문서 검사 명령을 명시할 수 있다.
4. history report에 문서 SHA-256·종류·검수 대기 상태가 표시된다. history list/search의 --ticket-kind planning 또는 design으로 구분한다.
5. 사용자가 검수한 현재 지문으로 history review를 기록한다. 결과 문서 게시와 Jira 상태 변경은 기존 preview/consent 승인 경계 안에서만 수행한다.

Jira는 기존 작업 유형과 4단계 보드를 유지하며 harness-kind-planning/design/development 라벨과 기획·설계 제목 접두사를 사용한다. 실행 판단은 제목/라벨이 아니라 승인된 ticket_kind를 따른다. 기존 Jira 티켓을 import하면 기본 개발 초안이므로 필요한 종류·산출물을 request revise로 명시하고 승인한다.

의존 티켓의 기준점은 기존 managed commit SHA 정책을 유지한다. 문서 티켓도 후속 실행의 dependency로 연결하려면 사용자 검수와 별도의 문서 Git 반영 승인·커밋이 필요하다. Confluence 페이지 자체를 실행 기준점으로 사용하거나 fan-in을 자동 병합하지 않는다.

## 검증 범위

독립 회귀 tests/harness-cli/ticket-artifacts.test.js는 실제 임시 Git 저장소·worktree·패치 적용·문서 검증·이력 및 스냅샷을 검사한다. 모델 응답과 사용자 수락은 fixture이며 실제 API 품질이나 개인 Jira/Confluence 게시 성공을 뜻하지 않는다. 이 기능을 구현하는 하네스 코드 자체는 Full 검증 대상이다.
