# 2026-11-27 Durable Review Decision Records

## Summary

Review breakpoints now stored in SQLite with exact tool-call digest, decision provenance, and replay support.

## Changes

- Review breakpoints are now stored in SQLite with the exact tool-call digest, question, proof, requested action, status, decision, reason, and reviewer identity. Decisions accept only approve, reject, or stop.
- If the process restarts, a replayed identical tool call can consume its stored decision instead of losing the review. A rejected decision's exact reason is the only note accepted as a human override. A reviewer can record a pending decision even if no in-memory waiter is connected; the endpoint reports that it was stored and will resume on replay.
- Authenticated decisions use the verified session subject, email, and role. Local terminal decisions are labeled as local operator actions.
- This does not make agent execution durable by itself. There is no worker lease, approval expiry, full approval-history UI, maker/checker policy, or multi-instance consistency. Those remain release gates.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, 34 tests, 0 failures.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.