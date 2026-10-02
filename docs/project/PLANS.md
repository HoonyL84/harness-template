# 프로젝트 플랜 (PLANS.md)

## 서비스 개요
- 하나의 중앙 하네스에서 여러 독립 Git 프로젝트를 등록하고 운영한다.
- 사용자의 자연어 요청을 프로젝트별 티켓으로 분해하고, 계획을 먼저 보여준 뒤 승인된 작업만 실행한다.
- 구현과 검증은 자동화하되 commit, push, merge는 사용자의 명시적 승인 전까지 금지한다.
- 완료된 기능은 근거와 함께 축적해 검색, 이력서, 포트폴리오 작성에 활용한다.

## 타겟 유저
- Windows, macOS, Linux에서 여러 개인·실무 프로젝트를 운영하는 개인 개발자
- 대화형 Codex와 API-key 기반 실행을 동일한 정책으로 사용하려는 사용자

## 핵심 작업 흐름
1. 사용자가 A, B 등 여러 프로젝트의 작업을 자연어로 요청한다.
2. 하네스가 프로젝트 매핑, 요청 이해, 가정, 제외 범위, 티켓, 의존성, 검증 및 알림 계획을 제시한다.
3. 사용자가 계획을 승인하거나 수정한다.
4. 승인된 티켓을 프로젝트별 격리 worktree에서 실행한다.
5. 실패하면 `BLOCKED`로 전환하고 실패 근거와 선택지를 알린다.
6. 성공하면 `REVIEW_READY`로 전환하고 diff, 테스트, 위험 및 경력 기록 초안을 알린다.
7. 사용자가 커밋을 명시적으로 승인한 경우에만 commit, push, merge를 실행한다.
8. 커밋 근거가 연결되면 경력 기록을 `VERIFIED`로 확정한다.

## 로드맵
- **운영 보강 구현 및 검증**: [개인 다중 프로젝트 운영 보강](OPERATIONS_COMPLETENESS_PLAN.md), [Jira + Confluence 설계](CONFLUENCE_PERSONAL_OPERATIONS.md), [사용 가이드](../HARNESS_PERSONAL_OPERATIONS_GUIDE.md). Jira 입출력/승인, 중요도/기본 3회 시도, 이력/검색/컨텍스트, Atlassian 연결 도우미, 3사 진단·관측/관리자 usage 및 Gemini 요청 수 조회를 구현했다. [운영 근거 보고서](../OPERATIONS_EVIDENCE_GUIDE.md)는 티켓별 지표·수용 기준 근거와 새 PC 절차를 제공한다. 실제 계정 리허설, 깨끗한 control-root 테스트, 새 기기 재현 및 사용자 최종 검수는 서로 다른 근거로 기록하며 전체 로드맵 완료를 뜻하지 않는다.
- **Task 1: Multi-project Registry** - 프로젝트 등록, 조회, 제거, 경로 및 Git 상태 진단
- **Task 2: Request Planning & Approval** - 자연어 요청의 프로젝트별 티켓 분해와 계획 승인 게이트
- **Task 3: Project-scoped Execution** - 프로젝트별 상태, 잠금, worktree, 검증 격리
- **Task 4: Commit Approval Gate** - 승인 전 commit, push, merge의 기술적 차단과 감사 기록
- **Task 5: Notifications & Dashboard** - 성공, 실패, 승인 요청 알림과 전체 상태 조회
- **Task 6: Career Evidence Ledger** - 기능·기술·문제·해결·성과·근거 기록 및 공개 범위 관리
- **Task 7: Search & Export** - 프로젝트와 기술별 검색, 이력서·포트폴리오 출력
- **Task 8: Multi-project E2E** - 최소 두 프로젝트와 Windows, macOS, Linux 회귀 검증

## 공통 완료 기준
- **MCP 우선 연결**: Jira/Confluence의 문서 관리·탐색은 MCP에 위임하고 하네스는 개발 실행/검증/승인/근거만 관리한다. Node CLI의 MCP 호출 경로와 opt-in REST 호환 경로를 분리한다. 실제 계정별 도구 매핑 검증 전에는 연결 완료로 표시하지 않는다. [설정 가이드](../ATLASSIAN_MCP.md)
- **기록 연결 보강**: `ops-followup-integration`에서 로컬 DRAFT의 Jira 연결, 관리형 작업/검수의 follow-up 캡처, 누락 audit/repair와 승인형 게시를 구현했다. 선택적으로 프로젝트당 최초 범위 승인 후 자동 기록하며 Git 승인은 별개다. 사용자 요청으로 모의 연동을 검증하고 실제 계정 리허설은 보류한다.
- 모든 상태는 `project_id:ticket_id`로 격리된다.
- 원본 프로젝트의 기존 미커밋 변경을 수정하거나 삭제하지 않는다.
- 사용자 승인 전 Git commit, push, merge가 실행되지 않는다.
- 고위험 변경과 자동 복구는 별도 승인을 요구한다.
- 성공과 실패 알림은 중복 없이 근거 및 다음 선택지를 포함한다.
- 경력 기록은 실제 티켓, 테스트, commit 또는 PR 근거를 연결한 `VERIFIED` 항목만 외부 출력에 사용한다.
- Node SDK 의존성을 추가하지 않고 기존 Node CLI와 내장 기능을 우선 사용한다.

## 기술 스택
- Node.js 24 기반 CLI
- Git worktree 기반 프로젝트별 작업 격리
- JSON 기반 설정과 원자적 상태 저장
- Slack 및 Telegram 알림
- 초기 검색은 의존성 없는 구조화 JSON 인덱스로 구현

## 제약사항 및 특이사항
- 중앙 하네스 자체 저장소와 관리 대상 프로젝트 저장소를 구분한다.
- 프로젝트 경로는 OS별 절대 경로를 로컬 설정에 저장하고 Git에는 커밋하지 않는다.
- API 키와 알림 토큰은 프로젝트 파일이 아닌 로컬 환경 설정에서만 읽는다.
- 중앙 모드에서도 기존 단일 프로젝트 사용법은 그대로 유지한다.
