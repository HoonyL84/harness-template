# SKILL: 코드 리뷰 (Code Review)
# 이 스킬 파일은 에이전트가 코드 리뷰 태스크를 수행할 때 읽는다.

---

## 수행 방법

1. 변경된 파일 목록 확인 (`git diff --name-only`)
2. 각 파일에 대해 아래 체크리스트 순서대로 검토
3. 문제 발견 시 파일명, 라인 번호, 문제 내용, 수정 방법을 명시
4. 리뷰 결과를 PR 코멘트 형식으로 출력

---

## 리뷰 체크리스트

### 🔴 Critical (반드시 수정)
- [ ] 시크릿/API 키 하드코딩 여부
- [ ] SQL Injection / XSS 취약점
- [ ] 트랜잭션 누락 또는 Self-Invocation
- [ ] N+1 쿼리 발생 여부
- [ ] Race Condition 가능한 연산에 원자성 보장 여부

### 🟡 Major (수정 권고)
- [ ] Redis Key TTL 설정 여부
- [ ] null 반환 여부 (Optional 미사용)
- [ ] 매직 넘버 사용 여부
- [ ] 커스텀 예외 미사용
- [ ] 로그에 식별자 누락

### 🟢 Minor (개선 제안)
- [ ] Javadoc/JSDoc 누락
- [ ] 테스트 커버리지 부족
- [ ] 네이밍 컨벤션 위반
- [ ] 불필요한 코드 (dead code)

---

## 출력 형식

```
## 코드 리뷰 결과

### 🔴 Critical
- `src/service/AdService.java:42` — Redis TTL 없는 Key 생성. `setExpire()` 추가 필요.

### 🟡 Major
- `src/controller/AdController.java:15` — null 반환. Optional<Ad> 사용 권고.

### 🟢 Minor
- `src/domain/Ad.java:8` — Javadoc 누락.

**총평**: Critical 1건 수정 후 머지 가능.
```
