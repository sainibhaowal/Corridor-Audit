# 2026-11-27 Durable Review Restoration & Timeout Handling

## Summary

Pending approval records listed from encrypted SQLite; restored after page reload/restart with timeout pause during review.

## Changes

- Pending approval records are now listed from encrypted SQLite into the history response and live event snapshot. The existing workbench restores them after page reload or process restart and submits the displayed approval ID with a decision.
- Repeated execution of the same tool call reuses its still-pending approval row. A case's verdict timeout pauses while that case awaits a reviewer, avoiding automatic dead-lettering during a valid human pause. If an old dead-lettered case receives a durable decision outside a live process, the resolve route requeues it to apply the recorded decision.
- Approval records still have no expiry or cancellation policy, maker/checker separation, or historical review screen. The local queue remains sequential, so a pending human decision holds later case execution.
- Dead-letter replay audit events now record the attempt count before the replay resets it, so the operations trace retains the actual retry history.

## Verification

- `npm run typecheck`: passed.
- `npm test` passed (75 tests), covering encrypted pending approval restoration after SQLite reopen, idempotent pending records, specific approval ID resolution, timeout pause during review, and replay attempt audit metadata.
- `npm run build` passed.
- Verification ran locally on Windows.