# 2026-11-27 Intake, Approval Request & Sync Start Audit Coverage

## Summary

Raw ingestion creation and parse outcome updates append audit events transactionally; review approval requests and provider sync starts produce events in same transaction.

## Changes

- Raw ingestion creation and parse outcome updates now append audit events in the same SQLite transaction as the raw record state. Webhook and email receipt status changes, including parse failures and successful queueing, are logged transactionally without storing payloads or error text.
- Review approval requests and provider sync starts now produce events in the same transaction as their durable rows. These complete the normal lifecycle trace from source receipt through parse status, case queue processing, review decision, verdict, provider sync, and operator replay.
- Invalid webhook signatures are rejected before durable receipt creation and remain outside the workspace event log. Workspace/integration settings changes still append separately after the primary mutation. External anchoring, export, retention locking, alerting, and immutable storage remain unconfigured.

## Verification

- Typecheck: passed.
- Integration test file: 25 passed, 0 failed.
- Full test suite: 63 passed, 0 failed.
- Production build: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.