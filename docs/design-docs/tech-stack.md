<!-- harness-profile: java-spring -->
# 기본 기술 스택 (Tech Stack Defaults)
# PLANS.md에서 프로젝트별로 override 가능

---

## 적용 범위

이 문서는 범용 템플릿이 강제하는 기본 스택이 아니라, Java/Spring 기반 프로젝트를 빠르게 시작할 때 사용할 수 있는 **선택형 참조 프로필**이다.

- 실제 기술 스택은 `docs/project/PLANS.md`에 명시된 내용을 최우선으로 적용한다.
- `PLANS.md`가 Java/Spring을 선택하지 않았다면 아래 백엔드, 데이터, 인프라 규칙을 자동 적용하지 않는다.
- 스택이 아직 정해지지 않았다면 에이전트는 이 문서를 근거로 임의 선택하지 않고 사용자에게 확인한다.

## 백엔드 (Java 생태계)

| 항목 | 기본값 |
|------|--------|
| 언어 | Java 21 (Record, Sealed Class, Virtual Thread) |
| 프레임워크 | Spring Boot 3.x, Spring Data JPA, Spring Kafka |
| 캐시 | Redis (Lettuce, Lua Script 기반 원자 연산) |
| 메시지 | Apache Kafka (`acks=all`, `enable.idempotence=true`) |
| 검색 | Elasticsearch |
| RPC | gRPC (서비스 간 통신) |
| DB | MySQL 8.x / PostgreSQL |
| 빌드 | Gradle (Kotlin DSL) |
| 컨테이너 | Docker, Kubernetes (HPA 고려) |
| 테스트 | JUnit 5, Mockito, Testcontainers |

---

## 프론트엔드

| 항목 | 기본값 |
|------|--------|
| 프레임워크 | React 18 + Vite |
| 스타일 | TailwindCSS |
| 전역 상태 | Zustand |
| 서버 상태 | React Query |
| 테스트 | Vitest + Testing Library |

---

## 인프라 (로컬 개발)

`docker-compose up -d` 로 실행:
- MySQL 8.0 (port 3306)
- Redis 7 (port 6379)
- Kafka + Zookeeper (port 9092)
- Elasticsearch 8 (port 9200)

---

> ⚠️ 이 스택은 기본값이다. `docs/project/PLANS.md`에 별도 스택이 명시되면 그것을 우선한다.

## 채택한 기술에만 적용하는 구현 규칙

## 2. Spring Boot 규칙

- Controller는 얇게 — 비즈니스 로직은 Service에만
- `@Transactional`은 Service 레이어에만, `readOnly` 명시
- `@Transactional` 자가 호출(Self-Invocation) 금지
- 설정값은 `@ConfigurationProperties`로 바인딩

---

## 3. JPA / DB 규칙

- N+1 방지 — `@EntityGraph` 또는 fetch join 명시
- 인덱스 전략 주석을 Entity 또는 Repository에 추가
- 대량 배치는 `saveAll()` + `@Modifying` 벌크 쿼리 검토

---

## 4. Redis 규칙

- Key 네이밍: `{domain}:{entity}:{id}` (예: `ad:budget:123`)
- TTL 없는 Key 생성 금지
- Race Condition 가능 연산은 Lua Script 또는 `WATCH/MULTI/EXEC` 사용

---

## 5. Kafka 규칙

- Consumer: `AckMode.MANUAL_IMMEDIATE` 고려
- 멱등 설계 필수 — 같은 메시지 두 번 처리해도 결과 동일
- DLT(Dead Letter Topic) 전략 명시
- Producer: `acks=all`, `enable.idempotence=true` 기본

---

## 6. 아키텍처 규칙

- 패키지 구조: 레이어드가 아닌 **도메인 중심**
- 의존 방향: `domain → application → infrastructure` (역방향 금지)
- 도메인 간 직접 의존 금지 — 이벤트 또는 인터페이스로 경계 유지
- 외부 API 호출: Circuit Breaker (Resilience4j) 필수
- 시크릿은 환경 변수 또는 Vault — 코드에 절대 커밋 금지

---

## 8. 테스트 규칙

- 비즈니스 로직 단위 테스트 필수 (커버리지 80% 이상)
- Repository: Testcontainers 기반 통합 테스트
- Kafka/Redis: EmbeddedKafka / `@DataRedisTest` 활용
- 테스트 메서드명: `메서드명_상황_기대결과`
- `Thread.sleep()` 금지 — `Awaitility` 사용

---

## 9. 작업 완료 자가 검증 체크리스트

### 기술 규칙
- [ ] N+1 쿼리가 발생하지 않는가?
- [ ] Redis Key에 TTL이 설정되어 있는가?
- [ ] Race Condition 연산에 원자성이 보장되는가?
- [ ] 커스텀 예외를 사용하고 있는가?
- [ ] 로그에 식별자가 포함되어 있는가?
- [ ] 시크릿이 코드에 하드코딩되지 않았는가?
