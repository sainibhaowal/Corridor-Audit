# 2026-11-27 Workspace Audit Trail

## Summary

Per-workspace SQLite audit table with monotonic sequence numbers and SHA-256 hash chain; bounded GET /api/audit-log endpoint.

## Changes

- Added a per-workspace SQLite audit table with monotonic sequence numbers and a SHA-256 hash link from each event to its predecessor. A verification method checks sequence continuity and recomputes each event hash. The bounded `GET /api/audit-log` endpoint allows workspace owners and controllers to inspect up to 500 events and view the chain verification result.
- Wired workspace setting updates, team member add/remove, webhook-secret rotation, integration connect/disconnect, and successful inbound webhook queueing. Event metadata is limited to 4 KB and current route callers record only action attributes. They do not include credentials, webhook secrets, or raw financial payloads. The log currently does not cover every case lifecycle, review decision, sync result, or failed intake.
- This detects row edits and accidental corruption. Because the chain and data share a local SQLite file, a privileged operator can rewrite both. There is no external hash anchor, immutable retention, SIEM export, or transaction coupling for every logged mutation. Treat this as an operational audit trail, not a compliance-grade ledger.

## Verification

- `npm run typecheck`: passed.
- `npm test`: 63 passed, 0 failed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.