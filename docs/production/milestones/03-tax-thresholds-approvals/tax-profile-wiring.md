# 2026-11-27 Workspace Tax Profile Wiring

## Summary

Tax country and withholding basis points stored as versioned workspace tax-policy snapshots with explicit invoice rate precedence.

## Changes

- Tax country and withholding basis points are stored as versioned workspace tax-policy snapshots. Non-tax workspace edits do not create tax versions.
- An explicit invoice rate, including zero, is used as supplied. If an invoice omits the rate, the terms assessment and deterministic withholding calculation use the current workspace profile. The assessment records the policy version, country, rate, and whether the value came from the invoice or workspace profile. The terms evidence explains this as a configured assumption, not a legal tax determination.
- CSV tax-rate values are validated as integer basis points in the 0 to 10,000 range. Missing CSV values remain missing so the workspace default can apply. Workspace API validates country codes and rate bounds.
- Tax profile basis points are not a jurisdictional tax engine. Effective-date policy authoring, maker/checker approval, historical replay under old policy, and legal validation are still required for production.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, 33 tests, 0 failures.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.