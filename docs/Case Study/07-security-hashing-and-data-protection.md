# 07 · Security and data-protection boundaries

This module describes security controls present in the local preview and the protections that are still missing. These implementation details are not a security certification or evidence that the application is suitable for live financial data.

![Current security controls and boundaries](./assets/security-defense-layers.svg)

## Implemented controls

### Integration credentials and webhook secrets

[`src/core/security/vault.ts`](../../src/core/security/vault.ts) encrypts integration credentials and webhook secrets with AES-256-GCM. The key is read from `CORRIDOR_VAULT_KEY` or stored locally in `data/.vault-key`. Protect and back up the database and key together; losing the key makes encrypted values unreadable. This encryption does not cover raw-ingestion content.

### Webhook signatures

[`src/core/security/webhook-signatures.ts`](../../src/core/security/webhook-signatures.ts) implements signature checks for supported Stripe, Wise, and Corridor headers. The request route can enforce configured signatures, but enforcement defaults to off. External webhook traffic should not be exposed until signature enforcement and secrets are configured and tested for the intended provider.

### Raw-ingestion fingerprints

The `raw_ingestions` table stores payload content, metadata, parse state, and a SHA-256 digest. The payload is stored unencrypted in SQLite. A digest can help detect a content mismatch when independently recomputed, but the application does not provide immutable or tamper-evident evidence storage, external timestamping, access-controlled audit trails, or retention enforcement. `SourceRef` checks validate structure; they do not authenticate documents or prove extracted values.

### Local command surface

`POST /api/terminal` exposes an allowlisted application command interface and does not execute arbitrary operating-system shell commands. This is not a substitute for user authentication or network access controls.

## Operational limits

- The app has no user authentication, authorization, or tenant isolation.
- The local timer and agent queue are in-process; there is no distributed durable job system.
- Integration sync, OAuth scopes, token refresh, pagination, and provider-specific field mappings are not complete across the catalog.
- No production secrets manager, key rotation workflow, backup/restore procedure, monitoring, incident response plan, or retention policy is included.
- Raw settlement payloads may contain sensitive personal or financial data and are currently stored as plaintext in the local database.

Use synthetic or public data for local evaluation. Before any live-data pilot, add and independently review access controls, data minimization, encrypted storage, key management, retention, audit logging, backup/restore, and provider-specific connector controls.
