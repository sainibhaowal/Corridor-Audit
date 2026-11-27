# 2026-11-27 Provider Request Bounds & Unconfigured Queue Behavior

## Summary

20-second HTTP request timeout for all provider calls; unconfigured LLM provider queues cases without invoking Mozaik.

## Changes

- Stripe, Wise, QuickBooks, Xero, generic provider reads, and OAuth token requests now use a shared 20 second HTTP request timeout. A stalled request aborts instead of holding its sync lease indefinitely. The timeout is per request; bounded pagination can still make a complete sync take longer.
- When no LLM provider is configured, accepted cases are persisted and remain queued. The local queue worker waits rather than invoking Mozaik with missing credentials, and startup does not attempt to replay queued cases until a provider is configured. The CLI gives a configuration error before starting an audit.

## Verification

- Verification on the local Windows environment: `npm run typecheck` passed; `npm test` passed, 71 tests and 0 failures; `npm run build` passed.
- Tests cover HTTP abort signaling and verify that unconfigured uploads remain in the durable queued state.
- No provider, LLM, AWS, or identity service was contacted or configured for this verification.