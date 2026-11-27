# 2026-11-27 Provider Sync & Audit Status Separation

## Summary

Sync history persists exact case IDs accepted by each provider fetch; integration activity view distinguishes fetching from downstream auditing.

## Changes

- Sync history now persists the exact case IDs accepted by each provider fetch. The integration activity view distinguishes fetching and fetch completion from downstream case auditing.
- Audit status is derived from the durable local case queue and reports queued, running, completed, failed, partial, or unknown. Existing sync records without stored case IDs report unknown instead of implying the audit finished. A completed fetch with no new cases is labeled as having no new cases.
- The provider sync request still returns after fetch and queue acceptance; audit execution remains asynchronous. This milestone does not add a distributed queue or make the local process a production deployment.

## Verification

- Verification on the local Windows environment: `npm run typecheck` passed; `node --import tsx --test tests/integrations-and-vault.test.ts` passed, 27 tests and 0 failures; `npm run build` passed; `git diff --check` passed.
- No external provider was contacted. Wise transfer sync still uses offset pagination because no verified incremental cursor was available.