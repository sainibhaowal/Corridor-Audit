# 2026-11-27 Provider Timeout Cannot Be Overridden by Caller Signals

## Summary

`fetchProvider` composes caller cancellation signal with configured request deadline; longer signal cannot bypass 20-second bound.

## Changes

- `fetchProvider` now composes a caller cancellation signal with its configured request deadline. Supplying a longer-lived signal no longer bypasses the 20 second provider request bound.

## Verification

- Verification in the local Windows environment: `npm run typecheck`, `npm test` (74 passed, 0 failed), and `npm run build` passed.
- A focused test verifies that an external 60 second signal cannot override a 5 millisecond helper deadline.