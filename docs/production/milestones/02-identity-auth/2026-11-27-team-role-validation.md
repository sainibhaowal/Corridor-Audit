# 2026-11-27 Team Role Validation & Owner Retention

## Summary

Workspace team invitations now accept only the four supported roles and enforce owner retention.

## Changes

- Workspace team invitations now accept only the four supported roles: owner, controller, analyst, and viewer. Runtime validation rejects crafted role strings even though TypeScript request types are narrower.
- Team removal now runs atomically with an active-owner count check. It refuses to remove the last active owner, returns a distinct not-found result for unknown members, and the API reports clear `409` and `404` responses. A remove request without a member ID now returns `400` instead of falling through to workspace settings updates. Existing UI response shape for successful operations is unchanged.

## Verification

- `npm run typecheck`: passed.
- Integration test file: 26 passed, 0 failed.
- Full suite: 68 passed, 0 failed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.