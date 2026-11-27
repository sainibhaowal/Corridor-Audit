# Environment & Security Configuration

This reference documents every environment variable in [`.env.example`](../../.env.example) and the security controls implemented under `src/core/security/` and `src/middleware.ts`.

---

## 1. Environment Variables

### LLM Providers (`src/core/llm/providers.ts`)
| Variable | Default / Example | Purpose |
| :--- | :--- | :--- |
| `LLM_PROVIDER` | *(auto-detect)* | Explicit override: `nvidia`, `gemini`, `groq`, `openrouter`, `openai`, `anthropic`, or `ollama`. |
| `LLM_API_KEY`, `LLM_MODEL` | *(optional)* | Universal key/model overrides for the selected provider. |
| `NVIDIA_API_KEY`, `NVIDIA_MODEL` | `nvidia/nemotron-3.5-super-vl-120b-a12b` | NVIDIA NIM endpoint credentials & default model. |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | `gemini-2.5-flash` | Google Gemini AI Studio credentials & default model. |
| `GROQ_API_KEY`, `GROQ_MODEL` | `llama-3.3-70b-versatile` | Groq endpoint credentials & default model. |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | `meta-llama/llama-3.3-70b-instruct:free` | OpenRouter credentials & default model. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | `gpt-5.4` | OpenAI credentials & default model. |
| `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | `claude-haiku-4-5` | Anthropic credentials & default model. |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | `http://localhost:11434/v1`, `llama3.2` | Local Ollama OpenAI-compatible endpoint. |
| `MOZAIK_API_KEY` | *(optional)* | Optional Mozaik Cloud telemetry key. |

### Server & Runtime Controls
| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `HOST`, `PORT`, `NO_OPEN` | `127.0.0.1`, `3000`, `0` | Next.js bind host/port and browser auto-open flag (`scripts/start.mjs`). |
| `HOT_FOLDER` | `./data/inbox` | Local directory watched for automatic file ingestion. |
| `MAX_CONCURRENT_LLM_CALLS` | `3` | Concurrency cap in `DynamicEndpointRouter`. |
| `PROVIDER_FULL_RECONCILIATION_INTERVAL_HOURS` | `168` | Periodic full-sync interval (7 days default) in `sync-worker.ts`. |
| `AUTO_APPROVE_BREAKPOINTS` | `false` | When `true`, auto-approves `SettlementGateInterceptionHandler` breakpoints (for headless/CLI runs). |
| `CORRIDOR_CLAMD_HOST`, `CORRIDOR_CLAMD_PORT` | *(unset)*, `3310` | Private ClamAV `clamd` TCP endpoint (`INSTREAM`). Production fails closed if unavailable. |

### Authentication, Vault & SSRF Controls
| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `CORRIDOR_AUTH_MODE`, `NEXT_PUBLIC_CORRIDOR_AUTH_MODE` | `local` | `local` (loopback evaluation) or `cognito` (production OIDC + RBAC). |
| `CORRIDOR_SESSION_SECRET` | *(required in prod)* | HMAC signing secret for `corridor_session` cookies (`src/core/security/auth.ts`). |
| `CORRIDOR_BOOTSTRAP_OWNER_EMAIL` | *(optional)* | Initial workspace owner email provisioned on bootstrap. |
| `CORRIDOR_PUBLIC_BASE_URL` | `http://localhost:3000` | Required HTTPS origin in production for OAuth callbacks (`src/core/security/public-origin.ts`). |
| `CORRIDOR_VAULT_KEY` | *(required in prod)* | 64-character hex (32-byte) AES-256-GCM master key (`src/core/security/vault.ts`). Production refuses to generate an unconfigured local key. |
| `CORRIDOR_PROVIDER_ENDPOINT_HOSTS` | *(unset)* | Comma-separated allowlist of hostnames for generic JSON connectors in production. |
| `COGNITO_ISSUER`, `COGNITO_DOMAIN`, `COGNITO_CLIENT_ID`, `COGNITO_CLIENT_SECRET`, `COGNITO_CALLBACK_URL` | *(unset)* | AWS Cognito OIDC configuration for production authentication. |

### Wise Platform
| Variable | Default | Purpose |
| :--- | :--- | :--- |
| `WISE_API_ENVIRONMENT` | `sandbox` | `sandbox` (Sandbox V2) or `production` (explicitly required in prod). |
| `WISE_API_VERSION` | `2026Q4` | Wise API version header. |
| `WISE_SANDBOX_CLIENT_ID`, `WISE_SANDBOX_CLIENT_SECRET` | *(unset)* | Wise Sandbox OAuth2 Basic auth credentials. |
| `WISE_PRODUCTION_CLIENT_ID`, `WISE_PRODUCTION_CLIENT_SECRET` | *(unset)* | Wise Production OAuth2 Basic auth credentials. |

---

## 2. Implemented Security Controls

| Layer | Module | Behavior |
| :--- | :--- | :--- |
| **Encryption at Rest** | `src/core/security/vault.ts` | AES-256-GCM authenticated encryption for credentials, `raw_ingestions`, `cases`, `audit_verdicts`, `review_approvals`, and OAuth PKCE verifiers. |
| **Auth & RBAC** | `src/core/security/auth.ts`, `authorization.ts`, `src/middleware.ts` | Signed session cookies (`jose`), Cognito `sub` binding, role hierarchy (`viewer < analyst < controller < owner`), and cross-site mutation blocking. |
| **Webhook Integrity** | `src/core/security/webhook-signatures.ts`, `webhook-event-id.ts` | Verifies Corridor HMAC-SHA256 (timestamped in prod) and `Stripe-Signature`; enforces idempotent `webhook_receipts` with lease recovery. |
| **SSRF & DNS Pinning** | `src/core/integrations/http.ts` | Rejects non-HTTPS schemes and private/loopback IP ranges; pins outbound `fetch`/connections to the validated public DNS address. |
| **Malware Scanning** | `src/core/security/malware-scan.ts` | Streams uploads and email attachments to ClamAV `INSTREAM`; fails closed in production if scanner is unreachable. |
| **Audit Chain** | `src/core/db/database.ts` | Hash-chained `workspace_audit_log` (`previous_hash` -> `event_hash`) detecting any out-of-band SQLite tampering. |
