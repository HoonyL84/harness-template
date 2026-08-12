# TICKET: security-dependency-refresh

## Type
fix

## Goal
- Refresh vulnerable transitive dependencies exposed by the blocking security gate

## Scope
- Remove the vulnerable fast-uri override and update package-lock.json with compatible security patches

## Out of Scope
- Direct dependency major-version upgrades

## Acceptance Criteria
- [ ] npm audit, Full verification, and GitHub security checks pass

## Risk
- low

## Notes
- Created from harness CLI.
