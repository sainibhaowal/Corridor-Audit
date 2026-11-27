# CorridorAudit engineering case study

This case study documents a local prototype for reviewing cross-border settlement records. It separates implemented behavior from example scenarios and future operational requirements; it is not a claim that the project is a production financial platform.

> **Data and deployment boundary:** Use synthetic or public data only. The application has no user authentication or tenant isolation. Raw ingestion content is stored unencrypted in local SQLite. Connector and audit outputs require human verification and do not move funds or establish legal recovery rights.

## Modules

| Module | Subject |
| --- | --- |
| [01 · Problem statement](./01-problem-statement.md) | Product problem and explicitly illustrative settlement arithmetic |
| [02 · Data ingestion](./02-data-ingestion-and-raw-vault.md) | Implemented input adapters, connector coverage, credential encryption, and raw-ingestion boundaries |
| [03 · System architecture](./03-system-architecture-and-pipeline.md) | Request flow, persistence, Mozaik execution, and limitations |
| [04 · Agent roles](./04-mozaik-4-plus-1-agents.md) | Four specialists, conditional anomaly agent, auditor barrier, and human review |
| [05 · Calculations](./05-algorithms-and-financial-math.md) | Minor-unit representation, conversion behavior, residual, and matching checks |
| [06 · Outputs and limits](./06-outputs-disputes-and-roi.md) | Current reports, review duties, no measured ROI, and deployment readiness |

## Implementation references

- [Repository README](../../README.md) — setup, implemented features, and local-use limits.
- [Architecture](../ARCHITECTURE.md) — code-level service and runtime map.
- [Version policy](../VERSIONING.md) and [changelog](../../CHANGELOG.md).

The diagrams and example values are explanatory. They do not represent a live bank connection, a verified customer result, or a production security certification.
