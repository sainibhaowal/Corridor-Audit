# 2026-11-27 Team Invitation Record Validation

## Summary

Team member creation now normalizes and validates email addresses with duplicate protection.

## Changes

- Team member creation now normalizes and validates email addresses, validates names and roles at the database boundary, and checks for an existing address within the workspace inside a `BEGIN IMMEDIATE` transaction. Duplicate API requests return HTTP 409; invalid records return HTTP 400. This protects against concurrent duplicate invitations without modifying existing member rows.
- Invitations remain database records only. No message is sent, and Cognito enrollment or another identity enrollment path must still be arranged by the workspace owner.

## Verification

- `npm test` passed (86 tests), including duplicate and malformed address checks at the database layer and duplicate HTTP conflict behavior.
- `npm run typecheck` passed.
- No email service or identity provider was contacted.