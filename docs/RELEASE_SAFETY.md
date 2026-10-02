# 릴리스 안전 정책

## 실무에서의 목표

오류가 절대 생기지 않는다고 보장하지 않는다. 로컬 통과를 원격 통과로 취급하지 않고, 실패한 변경을 main에 반영하기 전에 차단한다. 새로운 취약점, 외부 서비스 장애, runner 이미지 변경은 이후에도 발견될 수 있다. 검증 실패 알림은 숨기지 않고 수정 후보를 PR에서 검토한다.

## 변경과 승인 순서

1. 최신 main에서 티켓 단위 `codex/` 브랜치를 만든다.
2. 회귀 테스트를 추가하고 로컬 Full 검증을 수행한다. 완료 기록을 포함한 최종 커밋까지 검증한다.
3. 브랜치를 푸시하고 PR을 생성한다. main에는 직접 push하지 않는다.
4. PR의 정확한 최신 커밋에서 필수 체크가 모두 성공해야 한다. 수정 커밋이 추가되거나 main이 바뀌면 다시 검사한다.
5. 사용자가 변경 내용과 테스트의 적합성을 검수하고 명시적으로 승인한 뒤에만 squash 또는 rebase 병합한다. 자동 병합과 관리자 우회를 쓰지 않는다.
6. 로컬 main을 `git pull --ff-only`로 갱신하고 main의 후속 CI도 확인한다. OS별 CI가 성공하기 전에는 크로스 플랫폼 검수 완료라고 말하지 않는다.

## main 필수 체크

저장소 설정 원본은 `.github/main-protection.json`이다. GitHub 서버에 실제 적용하고 조회해 확인해야 효력이 있다. 파일을 commit하는 것만으로 보호가 켜지는 것은 아니다.

- `Release Gate`: 프로젝트 감지, 하네스 검증, 3개 OS, 사용 중인 언어의 테스트·빌드 작업을 합산한다. failure, cancelled, 필수 작업의 skipped, 누락된 결과를 차단한다. 미사용 언어의 조건부 skip만 허용한다.
- `Harness Cross-Platform (ubuntu-24.04)`
- `Harness Cross-Platform (macos-15)`
- `Harness Cross-Platform (windows-2025)`
- `Dependency Vulnerability Scan`: 런타임 high/critical 취약점과 검증된 비밀 노출을 차단한다. 개발 도구 취약점은 기존 정책대로 경고를 남기며 별도 검토한다.

체크는 GitHub Actions 앱의 결과만 인정하며 최신 main과 일치해야 한다. PR 필수, 관리자 적용, force push·브랜치 삭제 금지, 대화 해결 및 선형 이력을 설정한다. OS 체크 이름을 변경하면 서버 필수 체크 설정도 함께 갱신해야 한다.

1인 저장소에서는 자기 PR을 GitHub에서 직접 승인할 수 없으므로 별도 리뷰어 승인 수를 0으로 둔다. 이것이 AI에게 무승인 병합을 허용한다는 뜻은 아니다. 최종 사용자 승인은 하네스/대화의 운영 계약이며, GitHub는 CI와 PR 경계를 강제한다. 같은 계정의 API 권한만으로 인간과 AI를 식별하는 보안 샌드박스는 아니다. 팀에서는 독립 리뷰어 수와 CODEOWNERS, 별도 서비스 계정을 추가할 수 있다.

## 외부 변화 조기 감지

- 외부 Actions는 공식 저장소에서 확인한 전체 commit SHA로 고정한다. 태그명 오기나 이동을 막고 Dependabot PR에서 새 SHA를 검증한다.
- runner는 `latest` 대신 OS 버전 라벨을 사용한다. 해당 이미지 내부 도구 업데이트와 이미지 수명 종료까지 막는 완전한 고정은 아니며, 업그레이드는 PR에서 검증한다.
- `npm ci`와 lockfile로 설치 상태를 재현한다. Dependabot은 매일 업데이트 후보를 만들고 호환 업데이트를 묶는다. 자동 병합하지 않는다.
- 매주 전체 3개 OS CI, 매일 보안 점검을 실행한다. 같은 문제가 다시 발견되면 기존 실패 이력과 원인을 대조해 해결하며 성공으로 바꾸지 않는다.
- 대기 중인 같은 브랜치의 오래된 CI는 취소한다. 취소된 최신 필수 체크는 Release Gate를 통과할 수 없다.

## 서버 적용과 복제 저장소

저장소 관리자 권한으로 아래 설정을 적용한다. 새로운 템플릿 복제본에서도 별도로 적용해야 한다. 체크 앱 ID와 이름이 실제 저장소의 결과와 일치하는지 먼저 확인한다.

```bash
gh api --method PUT repos/OWNER/REPO/branches/main/protection --input .github/main-protection.json
gh api repos/OWNER/REPO/branches/main/protection
```

보호 규칙 때문에 병합이 막히면 실패 로그, 최신 PR 커밋, main 기준점과 필수 체크 이름을 확인한다. 보호를 끄거나 `--admin`, 강제 push, 테스트 skip으로 우회하지 않는다. 관리자는 설정을 변경할 수 있으므로 정책 자체의 변경은 별도의 고위험 승인 대상으로 남긴다.

공식 근거: [브랜치 보호](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches), [Actions SHA 고정](https://docs.github.com/en/actions/reference/security/secure-use), [호스팅 runner](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
