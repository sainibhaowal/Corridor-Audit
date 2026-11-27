# 2026-11-27 Storage Ownership Guards

## Summary

Case ID ownership enforced per workspace; verdict writes require case in same workspace; raw-ingestion lookup includes workspace condition.

## Changes

- A case ID already owned by one workspace cannot be overwritten by `saveCase` from another workspace. Verdict writes require the case to exist in the same workspace, and conflicting verdict ownership is rejected inside a transaction.
- Raw-ingestion lookup and outcome updates now include a workspace condition. Webhook duplicate lookup uses the receipt's workspace. Tests create a second workspace and verify that case collisions fail and raw records cannot be read or updated through the default workspace.
- This is a storage-layer safeguard, not completed multi-tenant support. API routes and sign-in still select `ws-default`, so workspace identity must be derived from the authenticated session and propagated through every API, job, SSE stream, and provider callback before multiple customer workspaces can be enabled.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, 43 tests, 0 failures.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.