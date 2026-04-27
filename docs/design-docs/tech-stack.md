# 기본 기술 스택 (Tech Stack Defaults)
# PLANS.md에서 프로젝트별로 override 가능

---

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
