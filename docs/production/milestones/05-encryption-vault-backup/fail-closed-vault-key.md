# 2026-11-27 Fail-Closed Production Vault Key

## Summary

Production encryption no longer creates or reads local development key file when `CORRIDOR_VAULT_KEY` is absent.

## Changes

- Production encryption no longer creates or reads the local development key file when `CORRIDOR_VAULT_KEY` is absent. Secret encryption and decryption fail with a configuration error until an explicit key is supplied. Local development retains the existing persistent key-file behavior.
- This guards against creating a fresh, unrelated key after a production restart. `CORRIDOR_VAULT_KEY` is still a manually supplied static key, not AWS KMS envelope encryption or automated rotation. Production deployment should provide it through a managed secret service until a KMS-backed key provider is implemented.

## Verification

- `npm run typecheck`: passed.
- `npm test`: passed, 42 tests, 0 failures.
- `npm run build`: passed.
- `git diff --check`: passed.
- Verification ran locally on Windows.