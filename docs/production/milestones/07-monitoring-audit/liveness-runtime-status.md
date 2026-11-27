# 2026-11-27 Public Liveness & Protected Runtime Status

## Summary

Public `/api/health` returns only `{ ok: true }`; provider details, queue counts, build provenance moved to `/api/runtime/status`.

## Changes

- Public `/api/health` now returns only `{ ok: true }` with `Cache-Control: no-store`. Provider details, queue counts, build provenance, and the local hot-folder path moved to `/api/runtime/status`, which uses the existing viewer authorization and request limits. The current UI fetches this authenticated status route without changing its layout.
- Health is a liveness probe only. It does not verify database, provider, or worker readiness, and runtime status describes this process rather than a multi-instance service.

## Verification

- End-to-end route test checks that public health omits runtime internals and that the local UI status route still returns provider/runtime data; an auth test confirms an unauthenticated request is rejected when authentication is enabled.
- `npm run typecheck`: passed.
- `npm test`: 50 passed, 0 failed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.