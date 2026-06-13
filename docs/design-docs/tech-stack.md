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
