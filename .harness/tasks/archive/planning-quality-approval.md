# TICKET: planning-quality-approval

## Type
feat

## Goal
- 계획 근거 기록·검사 및 승인 연결

## Scope
- T02: request capture/draft/planning, 입력/초안 불변 기록과 승인 지문 연결.
- 필수 질문·누락·소스/프로필/프롬프트 변경 시 승인 차단.
- 기존 Jira link가 출처 연결 후 새 근거 지문을 보존하도록 호환 연결.

## Out of Scope
- 유료 호출, 외부 게시, 원본 프로젝트 수정, 커밋·푸시

## Acceptance Criteria
- [x] 필수 질문, stale 소스/프로필/프롬프트, 변조·삭제 근거의 승인 실패.
- [x] 기존 레거시 계획 회귀와 Jira 가짜 API 게시/연결 테스트 통과.
- [x] 실제 CLI 단일·다중 프로젝트 capture/draft/approve/ready 통과.

## Risk
- 보통

## Notes
- 선행: planning-quality-contract. 후속: API/통합 리허설.
- 상세: docs/PLANNING_QUALITY_GUIDE.md. 외부 실계정 게시 없음.
- 통합 Full 근거: observability/metrics/planning-quality-rehearsal.verify.json.
- 구현·로컬 검수 완료, 커밋/릴리스 승인 전이므로 archive하지 않음.

## Completion
- Completed At: 2026-11-10T14:07:58Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
