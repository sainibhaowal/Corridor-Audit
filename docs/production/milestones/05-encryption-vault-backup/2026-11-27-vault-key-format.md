# 2026-11-27 Production Vault Key Format

## Summary

Production now accepts only a 32-byte random AES key expressed as exactly 64 hexadecimal characters.

## Changes

- Production now accepts only a 32-byte random AES key expressed as exactly 64 hexadecimal characters. Missing, passphrase, or malformed values fail before encryption or decryption. Local development continues to accept its existing persistent key file and development-only passphrase hashing.
- `.env.example` documents the required production format without containing a key. The local operations guide documents random generation and managed-secret delivery. AWS KMS integration, envelope encryption, and key rotation remain open.

## Verification

- Production-mode tests cover missing, weak, and correctly encoded keys.
- Full `npm test` passed (91 tests).
- `npm run typecheck` passed.
- `npm run build` passed.
- `git diff --check` passed.
- No production key was generated or configured.