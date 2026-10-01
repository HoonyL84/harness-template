# TICKET: context-backup-reliability

## Type
feat

## Goal
- Correct context omission reporting, preserve local evidence safely, and reduce ticket-context input without weakening approval boundaries.

## Scope
- Report documents excluded by file-count limits as well as byte limits.
- Add deterministic ticket-based path ranking, mandatory instruction preservation, omission metadata and a full-context escape hatch.
- Add encrypted evidence backup, inspection and preview-bound one-time quarantine restore.
- Import restored search evidence without activating old reviews, approvals, leases or publication queues.
- Independent regression tests and user-facing operation/limitation documentation.

## Out of Scope
- Godot automatic profiles, live execution migration, automatic cloud uploads or recurring backups.
- Semantic context search, guaranteed token savings, OS-level sandboxing, automatic commit/push/merge.
- Editing game or registered product repositories.

## Acceptance Criteria
- [x] File-count omissions are complete and produce truncated=true.
- [x] Ticket context retains core guidance or fails explicitly before an API invocation.
- [x] Wrong passwords, tampering, path escapes, symlink/junction paths and approval replay are rejected.
- [x] Restore does not overwrite live state or revive historical approvals.
- [x] Restored history can be searched and its evidence-only origin is visible.
- [x] Unit tests, coverage, lint and full verification pass before any commit.

## Test Plan
- Context inventory above 40 files; relevance ranking; mandatory guidance above byte budget; full-context opt-out.
- Encrypted round trip; credential exclusions; incorrect passphrase/ciphertext; entry hash/path attacks.
- Preview expiry/content binding/replay; quarantine and history restoration; partial-failure preservation.
- Source/output junctions, lock/running-state refusal and size bounds.
- Existing runner, managed approval and end-to-end regressions; full harness verification offline.

## Risk
- Medium: private evidence and restore side effects; encryption, quarantine and fresh approval requirements limit scope.

## Notes
- User approved implementation; Godot detection explicitly skipped as unnecessary for current game tooling.
- Canonical IntelliJ clone fast-forwarded to verified main 6174e78 before one development branch was created.
- This ticket remains active until user review and authorized Git release. No completion is inferred from test success.

- Validation: 219 tests passed with no failures or skips; coverage/lint Full verification passed on 2026-10-01 and is rerun before release.
- User explicitly approved commit, main integration and push on 2026-10-02.

## Completion
- Completed At: 2026-10-01T23:20:05Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
