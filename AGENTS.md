# AGENTS.md
# 에이전트 자율 주행 강령 (Agent Operating Protocol)
# 이 파일은 이 레포지토리에 진입하는 모든 AI 에이전트가 읽어야 하는 최상위 헌법이다.

---

## 0. 진입 체크리스트 (Entry Checklist)

에이전트는 작업 시작 전 반드시 다음을 순서대로 읽어야 한다:

1. **이 파일 (AGENTS.md)** — 행동 원칙 및 기술 규칙
2. **`docs/project/PLANS.md`** — 현재 프로젝트 목표, 로드맵, 기술 스택
3. **`.harness/tasks/active/`** — 현재 진행 중인 태스크의 EXEC_PLAN

---

## 1. 3대 절대 원칙

1. **인간에게 묻지 말고 문서를 먼저 읽어라**
   사소한 질문으로 흐름을 끊지 말 것. 모르면 `docs/`와 스크립트를 먼저 탐색하고 스스로 판단하라.
   단, PLANS.md에 명시되지 않은 고위험 결정(스키마 변경, 인프라 변경)은 반드시 슬랙으로 승인을 요청하라.

2. **master 브랜치 직접 수정은 금지다**
   반드시 `bash scripts/start-task.sh <task-name> <type>` 으로 격리된 워크트리에서 작업하라.
   모든 비즈니스 로직 파일 상단에는 `/* AI-generated */` 태그를 부착하라.

3. **결과로 증명하라**
   커밋 전 반드시 `bash scripts/verify-task.sh`를 실행하여 테스트, 린트, 빌드를 통과해야 한다.
   테스트를 삭제하거나 우회하여 통과시키는 것은 엄격히 금지한다.

---

## 2. 5단계 표준 작업 루프

```
[1] Explore   → PLANS.md 읽고 목표 파악
[2] Plan      → start-task.sh 실행 → EXEC_PLAN 작성
[3] Execute   → 워크트리에서 격리 구현
[4] Verify    → verify-task.sh 실행 (테스트 + 린트 + 빌드)
[5] Submit    → git commit (Husky 최종 검사) → complete-task.sh
```

---

## 3. 기술 스택 (프로젝트별 PLANS.md에서 override 가능)

### 백엔드 기본값 (Java 생태계)
- **언어**: Java 21 (Record, Sealed Class, Virtual Thread 적극 활용)
- **프레임워크**: Spring Boot 3.x, Spring Data JPA, Spring Kafka
- **캐시**: Redis (Lettuce, Lua Script 기반 원자 연산)
- **메시지**: Apache Kafka (`acks=all`, `enable.idempotence=true` 기본)
- **검색**: Elasticsearch (필요 시)
- **RPC**: gRPC (서비스 간 통신 필요 시)
- **DB**: MySQL 8.x / PostgreSQL
- **빌드**: Gradle (Kotlin DSL)
- **컨테이너**: Docker, Kubernetes (HPA 고려)
- **테스트**: JUnit 5, Mockito, Testcontainers

### 프론트엔드 기본값
- **프레임워크**: React 18 + Vite
- **스타일**: TailwindCSS
- **상태**: Zustand (전역), React Query (서버 상태)
- **테스트**: Vitest + Testing Library

> ⚠️ PLANS.md에 별도 스택이 명시된 경우, PLANS.md를 우선한다.

---

## 4. 코드 작성 규칙

### 4.1 공통
- 모든 public 메서드에 Javadoc/JSDoc 작성 (한국어 허용)
- 매직 넘버 금지 — 반드시 상수 또는 Enum으로 정의
- `null` 반환 금지 — `Optional<T>` 또는 빈 컬렉션 반환
- 로그는 적절한 레벨로, 식별자(campaignId, userId 등) 항상 포함
- `console.log` / `System.out.println` 커밋 금지

### 4.2 Spring Boot
- Controller는 얇게 — 비즈니스 로직은 Service에만
- `@Transactional`은 Service 레이어에만, `readOnly` 명시
- `@Transactional` 자가 호출(Self-Invocation) 금지
- 설정값은 `@ConfigurationProperties`로 타입 안전하게 바인딩

### 4.3 JPA / DB
- N+1 문제 방지 — `@EntityGraph` 또는 fetch join 명시
- 인덱스 전략을 설명하는 주석을 Entity 또는 Repository에 추가
- 대량 배치는 `saveAll()` + `@Modifying` 벌크 쿼리 병행 검토

### 4.4 Redis
- Key 네이밍 강제: `{domain}:{entity}:{id}` (예: `ad:budget:123`)
- TTL 없는 Key 생성 금지
- Race Condition 가능성이 있는 연산은 Lua Script 또는 `WATCH/MULTI/EXEC` 사용

### 4.5 Kafka
- Consumer는 `AckMode.MANUAL_IMMEDIATE` 고려
- 멱등 설계 필수 — 같은 메시지를 두 번 처리해도 결과 동일
- DLT(Dead Letter Topic) 전략 명시
- Producer는 `acks=all`, `enable.idempotence=true` 기본

### 4.6 아키텍처
- **패키지 구조**: 레이어드가 아닌 **도메인 중심** 패키지
- 도메인 간 직접 의존 금지 — 이벤트 또는 인터페이스로 경계 유지
- 외부 API 호출은 Circuit Breaker (Resilience4j) 필수
- 시크릿은 환경 변수 또는 Vault — 코드에 절대 커밋 금지

---

## 5. 테스트 규칙

- 비즈니스 로직: 단위 테스트 필수 (커버리지 80% 이상)
- Repository: Testcontainers 기반 통합 테스트
- Kafka/Redis: EmbeddedKafka / `@DataRedisTest` 활용
- 테스트 메서드명: `메서드명_상황_기대결과` 한국어 허용
- `Thread.sleep()` 금지 — `Awaitility` 사용

---

## 6. 안전 가드레일 (Safety Guardrails)

- **DB 쓰기 작업 전 반드시 슬랙 승인 요청** — 자동 실행 금지
- **프로덕션 배포 명령 자동 실행 금지**
- **파일 삭제 전 반드시 슬랙 승인 요청**
- 인프라 변경 명령(`kubectl apply`, `terraform apply`)은 diff 출력 후 승인 대기
- `.env`, `application-prod.yml` 파일은 읽기만 허용, 수정 금지

---

## 7. Git 컨벤션

커밋 형식: `{type}({scope}): {요약}`

| type | 용도 |
|------|------|
| `feat` | 새 기능 |
| `fix` | 버그 수정 |
| `refactor` | 리팩토링 (동작 변경 없음) |
| `test` | 테스트 추가/수정 |
| `docs` | 문서/주석 |
| `chore` | 빌드, 의존성 |

---

## 8. 에러 대응 프로토콜

| 상황 | 대응 |
|------|------|
| 단위 테스트 실패 | 코드 수정. 테스트 삭제/우회 금지. 3회 이상 실패 시 슬랙 보고 |
| 의존성 충돌 | PLANS.md 기술 제약 확인 → 스택 외 패키지는 슬랙 승인 |
| 환경 변수 누락 | `.env.template` 확인 → 작업 중단 후 슬랙 알림 |
| 요구사항 모호 | PLANS.md 기준 판단 → 불명확 시 EXEC_PLAN에 가정(Assumption) 명시 |
| 워크트리 오류 | `git worktree remove -f` 후 재생성 |

---

## 9. 작업 완료 기준 (Definition of Done)

아래를 모두 충족해야 완료:

- [ ] 코드 컴파일 및 기존 테스트 전체 통과
- [ ] 새 기능에 대한 테스트 추가
- [ ] 아래 자가 검증 체크리스트 통과
- [ ] 변경 사항 요약 슬랙 알림 발송

### 자가 검증 체크리스트
- [ ] N+1 쿼리가 발생하지 않는가?
- [ ] Redis Key에 TTL이 설정되어 있는가?
- [ ] Race Condition 가능성이 있는 연산에 원자성이 보장되는가?
- [ ] 커스텀 예외를 사용하고 있는가?
- [ ] 로그에 식별자가 포함되어 있는가?
- [ ] 시크릿이 코드에 하드코딩되지 않았는가?
