## 📋 변경 내용 (What)
<!-- 무엇을 변경했는지 간략히 설명 -->


## 🎯 변경 이유 (Why)
<!-- 왜 이 변경이 필요한지 -->


## 🧪 테스트 방법 (How to Test)
<!-- 어떻게 검증했는지 -->
- [ ] 단위 테스트 추가/수정
- [ ] 직접 실행 확인

## ⚠️ 주의사항 (Side Effects)
<!-- 이 변경이 영향을 줄 수 있는 다른 영역 -->


## ✅ 셀프 체크리스트
- [ ] `verify-task.sh` 통과
- [ ] `verify-task.sh --offline` 통과 (키/네트워크 없는 환경 기준)
- [ ] `health-check.sh` 통과
- [ ] 새 N+1 쿼리 없음
- [ ] Redis Key TTL 설정됨
- [ ] `console.log` / `System.out.println` 제거
- [ ] 시크릿 하드코딩 없음
- [ ] 컨텍스트 문서 갱신 (`memory/*` 또는 `.harness/tasks/active/*` 필요 시)

---

## 🤖 AI 에이전트 자가 평가 (AI-generated)
<!-- AI 에이전트가 자신의 작업을 평가하고 기록합니다. -->
- **Rework Count (재작업 횟수)**: 0회
- **Confidence Score (구조적 안정성 확신도)**: 0/100
- **Self-Correction Log**: 
  - *예: 최초 작성 시 Layered Architecture 위반(Domain -> Infrastructure 참조)이 AI 리뷰에서 지적되어 수정함.*
  - 없음
