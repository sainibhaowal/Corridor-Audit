# 2026-11-27 Stable Cognito Subject Membership Binding

## Summary

Team members now store a Cognito `sub` separately from their verified email address with binding protection.

## Changes

- Team members now store a Cognito `sub` separately from their verified email address. API authorization resolves the active member by subject, then checks the current stored role. First verified sign-in binds an unbound invitation. A different subject cannot claim an already-bound membership, even if it presents the same verified email. When the same subject returns with a newly verified email, the existing membership email and name are refreshed without changing its role, and that refresh is audited.
- Existing local SQLite databases receive the nullable `identity_sub` column and a per-workspace unique partial index without replacing team rows. Cognito remains an external setup requirement, and workspace routing still targets the current `ws-default` workspace.

## Verification

- `npm run typecheck`: passed.
- Auth tests: 10 passed, 0 failed.
- Full suite: 67 passed, 0 failed.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.