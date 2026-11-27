# 2026-11-27 Identity Milestone — Local Code Only

## Summary

Implemented Cognito hosted sign-in flow with PKCE, role-based access control, and session management.

## Changes

- Added a Cognito hosted sign-in flow using authorization code, PKCE, state, nonce, HTTPS issuer checks, verified-email validation, and short-lived HTTP-only session cookies. The flow follows [Amazon Cognito's PKCE guidance](https://docs.aws.amazon.com/cognito/latest/developerguide/using-pkce-in-authorization-code.html).
- Protected workbench pages and APIs fail closed when production mode is active. API handlers recheck the current active team row and role, so removing or changing a member rejects their next API request. Role thresholds distinguish analyst, controller, and owner actions. Cross-origin mutation requests are rejected.
- Verified invited team emails activate on first Cognito sign-in. `CORRIDOR_BOOTSTRAP_OWNER_EMAIL` creates the initial owner after that identity is verified. The workbench shows a sign-out control when Cognito mode is built.
- Model-provided override text no longer bypasses the human review gate. Only the exact note stored after a human rejection can override the fee flag, and the note is consumed by that case's finalization.
- Webhook signature verification is mandatory in production even if the local setting is off.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, 26 tests, 0 failures, including session integrity, role gate, invite activation, owner bootstrap, wire-only handling, and MT103 obligation separation.
- `npm run build`: passed.
- `npm audit --omit=dev`: zero vulnerabilities after pinning PostCSS to a fixed compatible release through npm overrides.
- This is not an activated identity deployment. Cognito pool, hosted domain, client, callback URL, session secret, and bootstrap owner email are not configured locally. Team invitations still do not send email, workspace data remains one fixed workspace, and an already-open SSE stream is not immediately closed when membership is removed. Phase 2 stays in progress.