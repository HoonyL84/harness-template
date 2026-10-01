# TICKET: backup-macos-path-fix

## Type
fix

## Goal
- Fix macOS backup failures caused by legitimate /var, /tmp and /etc system aliases.

## Scope
- Canonicalize only verified macOS aliases to their expected /private targets.
- Continue rejecting user-controlled symlinks/junctions, including linked backup roots and nested paths.
- Deterministic cross-platform unit coverage plus existing backup round-trip and adversarial regressions.

## Out of Scope
- Relaxing general path safety, changing backup formats, changing CI safety gates, product repositories.

## Acceptance Criteria
- [x] Verified macOS system prefixes normalize without whitelisting nested links.
- [x] Arbitrary targets, partial-prefix names and other operating systems are not normalized.
- [x] Existing backup/restore security tests and Full verification pass.

## Test Plan
- macOS path normalization with injected system realpath mapping; unexpected targets and platform isolation.
- Existing encrypted round trip, root/nested junction refusal, expiry/replay and malformed archive tests.
- Full coverage/lint; Windows smoke test; actual macOS/Linux/Windows CI after user-approved publication.

## Risk
- Low: narrow verified alias exception; no generic symlink following.

## Notes
- CI run 36940382998 failed only in macos-latest backup tests; Security Scan succeeded.
- Local validation does not substitute for actual macOS CI. Git release requires explicit user approval.
- User approved commit, main integration and push on 2026-10-02; actual matrix CI must pass before merging.
