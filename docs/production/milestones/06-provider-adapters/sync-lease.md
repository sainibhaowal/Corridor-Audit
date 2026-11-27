# 2026-11-27 Local Provider Sync Lease

## Summary

Provider syncs acquire SQLite lease keyed by workspace and provider; competing processes wait for current run.

## Changes

- Provider syncs now acquire a SQLite lease keyed by workspace and provider. Competing local processes wait for the current run, and the manual sync route returns HTTP 409 if the lease remains held past its wait window. Lease renewal runs during provider fetches, and writes are stopped if ownership is lost.
- When a new worker acquires a lease, any prior sync run left in `running` is marked failed as interrupted and recorded in the workspace audit trail. Scheduled polling skips a provider that is still busy and continues with other providers.
- This coordinates processes sharing the same local SQLite file only. The timer remains process-local, there is no durable scheduled retry queue, and provider calls still need consistent network timeouts before long-running production use.

## Verification

- Verification on the local Windows environment: `npm run typecheck` passed; `npm test` passed, 70 tests and 0 failures; `npm run build` passed.
- Coverage includes two independent SQLite connections competing for the same sync lease and the existing concurrent QuickBooks sync flow.
- No external provider was contacted. No AWS, identity, or mail service was configured.