# 아키텍처 핵심 신념 (Core Beliefs)
# AGENTS.md에서 참조하는 세부 코딩 규칙 문서

---

## 1. 공통 코딩 규칙

- 모든 public 메서드에 Javadoc/JSDoc 작성 (한국어 허용)
- 매직 넘버 금지 — 상수 또는 Enum으로 정의
- `null` 반환 금지 — `Optional<T>` 또는 빈 컬렉션 반환
- 로그에 항상 식별자 포함 (campaignId, userId 등)
- `console.log` / `System.out.println` 커밋 금지

---

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

## 7. 안전 가드레일

- **DB 쓰기 전 슬랙 승인** — 자동 실행 금지
- **프로덕션 배포 명령 자동 실행 금지**
- **파일 삭제 전 슬랙 승인**
- `kubectl apply`, `terraform apply` → diff 출력 후 승인 대기
- `.env`, `application-prod.yml` 읽기만 허용, 수정 금지

---

## 8. 테스트 규칙

- 비즈니스 로직 단위 테스트 필수 (커버리지 80% 이상)
- Repository: Testcontainers 기반 통합 테스트
- Kafka/Redis: EmbeddedKafka / `@DataRedisTest` 활용
- 테스트 메서드명: `메서드명_상황_기대결과`
- `Thread.sleep()` 금지 — `Awaitility` 사용

---

## 9. 작업 완료 자가 검증 체크리스트

- [ ] N+1 쿼리가 발생하지 않는가?
- [ ] Redis Key에 TTL이 설정되어 있는가?
- [ ] Race Condition 연산에 원자성이 보장되는가?
- [ ] 커스텀 예외를 사용하고 있는가?
- [ ] 로그에 식별자가 포함되어 있는가?
- [ ] 시크릿이 코드에 하드코딩되지 않았는가?
