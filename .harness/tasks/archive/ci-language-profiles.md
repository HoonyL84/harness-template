# TICKET: ci-language-profiles

## Type
feat

## Goal
- Enforce coverage and standard product tests for every supported CI language profile

## Scope
- Extend GitHub Actions detection and jobs for Node, Gradle, Maven, Python, Go, Rust, and .NET

## Out of Scope
- Project-specific deployment and integration-test infrastructure

## Acceptance Criteria
- [x] Workflow policy tests, Full verification, and all applicable GitHub checks pass

## Risk
- medium

## Notes
- Created from harness CLI.
- PR #33 verified Node coverage, security, governance, and Windows/macOS/Linux checks.
- Product-language jobs skip when their root project markers are absent.

## Completion
- Completed At: 2026-08-12T08:28:49Z
- Verify Result: pass
- Rework Count: 0
- Last Failure: none
