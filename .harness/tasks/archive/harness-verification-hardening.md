# TICKET: harness-verification-hardening

## Type
fix

## Goal
- Strengthen generic verification, security gates, smoke isolation, and CLI testability.

## Scope
- Detect and verify Node, Gradle, Maven, Python, Go, Rust, and .NET projects.
- Make high-severity dependency audit findings fail CI.
- Isolate harness smoke tests from product-specific test suites.
- Make CLI dispatch testable without requiring child-process execution.
- Raise the enforced coverage floor.

## Out of Scope
- Dependency action upgrades already covered by Dependabot pull requests.
- Large-scale decomposition of the CLI core.

## Acceptance Criteria
- [x] Full and Quick verification cover all supported project profiles.
- [x] Security audit failures block the workflow.
- [x] Cross-platform smoke tests use a harness-only Full verification command.
- [x] Unit tests, lint, coverage, and the Windows smoke test pass; Full verification is the final gate.

## Risk
- Medium: verification and CI behavior changes across operating systems.

## Notes
- Created from harness CLI.

## Completion
- Completed At: 2026-08-12T08:05:42Z
- Verify Result: pass
- Rework Count: 1
- Last Failure: Node coverage: ERROR: Coverage for branches (73.47%) does not meet global threshold (74%)
