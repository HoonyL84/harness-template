# 계획 품질 고도화 검증 기록

일자: 2026-11-04. 작업 브랜치: `codex/operational-binding`.
범위: 승인된 T01~T05의 구현과 로컬 격리 리허설. main 반영/실계정 검증 보고서가 아니다.

## 구현 결과

| 단위 | 결과 |
|---|---|
| T01 입력·출력 | 선택 자료와 프롬프트 보존, 정확한 인용, 위험도/테스트/관계 계약 |
| T02 승인 연결 | 불변 초안/이전 근거, stale·질문 차단, 기존 Jira link 호환 |
| T03 API 초안 | 3사 대역 테스트, 기본 dry-run, 명시 전송 승인, 1회 호출, 실패 기록 |
| T04 평가·검수 | 기존 eval 확장, 합성 6사례, 사람 평가/수정 기록, 조건별 비교 |
| T05 운영 경로 | 실제 CLI 단일·다중 프로젝트 승인, 백업 포함, 가이드/진입 문서 |

## 확인한 근거

- `node tests/harness-cli/run.js`: 357개 통과, 실패/skip 0. 로컬 CLI 프로세스 테스트 포함.
- `node --test tests/harness-cli/planning-quality.test.js`: 신규 묶음 12개 통과.
- 커버리지 실행은 CLI 자식 프로세스 중복 집계 방지를 위해 7개 프로세스 테스트를 의도적으로 생략한다. 일반 테스트에서는 실행한다.
- 기존 coverage 기준(라인/문장 70%, 함수 75%, 분기 73%)을 낮추지 않았다.
- 최종 Full 검증 및 현재 콘텐츠 지문: `observability/metrics/planning-quality-rehearsal.verify.json`.
- 원문 실행 로그: `observability/traces/planning-quality-full-test.log`, `planning-quality-targeted.log`, `planning-quality-coverage.log`, `planning-quality-full-verify.log`.
- Full 결과의 유효성은 이 문서 문구가 아니라 실제 성공 기록과 현재 콘텐츠 지문 일치로 판단한다.

## 리허설에서 교정한 결함

1. 검수 JSON이 내부 ID를 덮어쓰지 못하도록 허용 필드를 제한하고 검수 지문과 근거 지문을 분리했다.
2. 미관측 지연을 0으로 표현하지 않고 null로 보존했다. API와 저장 응답 평가를 혼합 비교하지 않는다.
3. Confluence 연결 설정의 실제 `confluence_projects` 매핑을 사용하고 캐시 사이트/공간/버전/TTL을 검사했다.
4. Jira 출처 연결 시 계획 본문을 그대로 보존하면서 새 근거 지문을 만들도록 연결했다. JSON 키 순서 차이는 내용 변경으로 오판하지 않는다.
5. 프롬프트 변경 뒤 이전 계획 근거를 재사용하지 못하도록 본문을 입력 스냅샷에 보존했다. API에는 중복 전송하지 않는다.

## 보장하지 않는 것

- 자동 검사는 구조/출처/경계 검사다. 인용의 의미적 타당성, 계획 누락, 실제 모델의 추론 품질은 사람이 평가한다.
- 합성 응답 및 가짜 API 성공은 모델 성능·환각 감소·비용 절감 증명이 아니다. 이 수치는 아직 측정하지 않았다.
- 이번에는 실제 업무 원문을 외부 모델에 보내지 않았다. 첫 실제 업무의 검수/수정량 수집과 유료 모델 비교는 별도 운영 단계다.
- Confluence 캐시의 신선도는 로컬 수집 시각 기준이다. 원격 최신 버전을 실시간 보장하지 않는다.
- Windows 로컬 검증이다. macOS/Linux CI, 실제 Jira/Confluence 게시, Git 커밋·푸시·병합은 이번 범위에 없다.
- 기존 개인 파일과 operational-binding 변경은 보존했다. 티켓은 커밋/릴리스 승인 전이므로 active에서 근거를 유지한다.
