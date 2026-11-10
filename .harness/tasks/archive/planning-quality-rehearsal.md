# TICKET: planning-quality-rehearsal

## Type
feat

## Goal
- 통합 리허설과 사용자 가이드

## Scope
- T05: 실제 CLI 격리 프로세스의 단일/다중 프로젝트 승인 리허설.
- Confluence 캐시 범위/버전/TTL, Jira 연결 fake transport, 기존 백업 포함 확인.
- 사용자 가이드, 에이전트 진입 안내, 전체 회귀/커버리지/린트/Full/drift 게이트.

## Out of Scope
- 유료 호출, 외부 게시, 원본 프로젝트 수정, 커밋·푸시

## Acceptance Criteria
- [x] 단일/다중 프로젝트 CLI 및 입력·이전 초안·검수의 백업 포함 테스트.
- [x] 일반 전체 테스트 357개 통과, API/외부 게시/제품 코드 변경 없이 리허설.
- [x] 가이드·프롬프트·도움말·진입 문서 연결.

## Risk
- 보통

## Notes
- 선행: T02/T03/T04. 기존 operational-binding 미커밋 변경과 함께 로컬 통합 검증.
- 전체 검증의 최종 성공 여부와 현재 콘텐츠 지문은 observability/metrics/planning-quality-rehearsal.verify.json에서 확인.
- 보고서: docs/project/PLANNING_QUALITY_VERIFICATION.md.
- 실제 업무 품질 평가, 유료 모델 비교, 실계정 게시, 원격 CI/릴리스는 수행하지 않음.
- 구현·격리 리허설 완료, 커밋/릴리스 승인 전이므로 archive하지 않음.

## Completion
- Completed At: 2026-11-10T14:08:52Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
