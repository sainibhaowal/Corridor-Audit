# 2026-11-27 Review Approval Expiry & Version Binding

## Summary

New human review requests expire after 24 hours with case payload digest and review-policy ID binding.

## Changes

- New human review requests expire after 24 hours and persist the digest of the saved case payload plus the active review-policy ID. Resolution fails closed if either changes. Stored approval decisions and human override notes are only reusable against the same case and policy versions.
- Expired or superseded approvals are audited and removed from the pending list. The local worker resolves an in-process gate safely when its approval becomes invalid, recording `REVIEW_REQUEST_INVALIDATED` instead of claiming an operator stopped it. Existing approvals without a provable historical policy version are superseded during additive migration and need a fresh review.
- The existing review interface and approve, reject, and stop actions are preserved. Approval cancellation and a history view remain open.

## Verification

- Full `npm test` passed (84 tests).
- Focused integration tests passed (41 tests).
- `npm run typecheck` passed.
- `npm run build` passed.
- `git diff --check` passed.
- No provider or cloud service was contacted.