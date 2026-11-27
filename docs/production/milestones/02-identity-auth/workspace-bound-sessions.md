# 2026-11-27 Workspace-Bound Sessions & Partial API Scoping

## Summary

Signed sessions now include the member's workspace ID with partial API isolation.

## Changes

- Signed sessions now include the member's workspace ID. Each API authorization checks the active membership in that workspace, and API rate-limit buckets include the workspace identity. Tokens issued before this claim existed are rejected and require sign-in again.
- Integration listing and connect/disconnect, workspace settings, audit-log reads, raw-ingestion reads, and dead-letter listing use the workspace established by request authorization. Workspace context lookup throws if authorization did not establish a context, instead of silently selecting the default workspace.
- Routes that still use the default workspace or process-global runtime state reject non-default workspace sessions with HTTP 503. Login still provisions against `ws-default`; the UI cannot create or switch workspaces. This milestone is partial API isolation and does not represent end-to-end tenant isolation.

## Verification

- `node --import tsx --test tests/auth.test.ts` passed (11 tests).
- `npm test` passed (85 tests).
- `npm run typecheck` passed.
- `npm run build` passed.
- The authorization test creates a second workspace and verifies scoped integration data plus denial from an unmigrated history route. No production identity provider or external service was contacted.