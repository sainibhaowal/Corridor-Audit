# 2026-11-27 Atomic Webhook Case Acceptance

## Summary

Inbound JSON webhooks and email adapter events persist normalized case rows, raw-ingestion parse outcome, and receipt status `queued` in one SQLite transaction.

## Changes

- Inbound JSON webhooks and email adapter events now persist normalized case rows, raw-ingestion parse outcome, and receipt status `queued` in one SQLite transaction. The orchestrator starts only after commit, and its local startup recovery resumes queued cases after a process restart.
- A conflict or failed write rolls the acceptance transaction back; the existing receipt remains retryable. Initial raw receipt creation and parsing remain separate, so a crash in that window leaves a `received` event that a provider retry can safely resume.
- Raw evidence now starts with parse state `received`; only successful parsing changes it to `parsed`. The Raw Data Vault shows received records as pending instead of reporting them as parsed early.

## Verification

- `npm run typecheck`: passed.
- `npm test` passed (77 tests), covering transaction rollback for case, parse, and receipt status writes plus the webhook endpoint's durable queued case response.
- `npm run build` passed.
- Verification ran locally on Windows.