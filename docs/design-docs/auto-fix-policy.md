# L4.5 Auto-fix Policy

이 문서는 검증 실패를 AI가 제한적으로 복구하는 L4.5 실행 경계를 정의한다.
목표는 무인 자율 개발이 아니라, 반복 가능한 저위험 오류를 한 번 안전하게 수정하고 인간 검토로 넘기는 것이다.

## 활성화

자동 수정은 기본적으로 꺼져 있다. 아래 조건을 모두 만족할 때만 동작한다.

- `HARNESS_AGENT_MODE=api`
- 사용할 provider의 API 키 설정
- `HARNESS_AUTO_FIX=true` 또는 `verify --auto-fix`
- 오프라인 모드가 아님

```bash
npm run harness -- verify --auto-fix
```

Windows에서도 동일한 Node CLI 명령을 권장한다.

```powershell
npm.cmd run harness -- verify --auto-fix
```

## 허용 범위

- 검증 실패당 AI 패치 생성 1회
- 패치 최대 5개 파일, UTF-8 기준 100KB
- 기존 소스 또는 테스트 파일만 수정
- `src`, `app`, `lib`, `test`, `tests`, `__tests__` 경로를 포함한 파일
- 허용된 프로그래밍 언어 및 프런트엔드 소스 확장자
- 모노레포의 `frontend/src`, `backend/src`, `packages/*/src` 형태 지원

## 차단 범위

- 파일 생성, 삭제, 이름 변경, 복사
- `.env*`, 비밀값, 의존성 manifest와 lockfile
- CI, 스크립트, 하네스 자체 코드와 설정
- 인프라, Terraform, Docker Compose, DB migration
- 문서, memory, prompt, eval, observability 데이터
- 자동 커밋, 자동 푸시, 자동 병합

## 실행 순서

1. 프로젝트 검증을 실행한다.
2. 실패 로그의 제한된 범위를 AI에 전달한다.
3. unified diff 형식의 패치 하나를 받는다.
4. 경로, 파일 종류, 크기, 변경 수를 정책으로 검사한다.
5. `git apply --check` 후 패치를 적용한다.
6. 전체 검증을 한 번 다시 실행한다.
7. 성공하면 변경을 유지하고 사람이 diff를 검토한다.
8. 실패하면 `git apply --check -R` 후 패치를 원복하고 실패를 기록한다.

원복까지 실패하면 `CRITICAL` 로그를 남기고 즉시 종료한다. 이 경우 작업 트리를 직접 확인해야 한다.

## 레벨 경계

이 기능은 L4의 진단·검증 자동화에 제한적 복구 루프를 추가한 L4.5다.
고위험 변경 승인, 장기 목표 재계획, 다중 에이전트 조정, 운영 배포와 장애 복구를 스스로 수행하지 않으므로 L5로 간주하지 않는다.
