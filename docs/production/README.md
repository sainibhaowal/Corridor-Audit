# CorridorAudit Production Engineering Record

This folder is the implementation record for making the existing CorridorAudit application safe and reliable for production use. It supplements the product case study. It does not replace or rewrite the existing application documentation.

## Documents

| Document | Purpose |
| --- | --- |
| [Current behavior and gaps](./01-current-state.md) | Code-backed description of what runs today and what remains incomplete |
| [Target architecture](./02-target-architecture.md) | End-to-end production design while retaining the current finance workflow |
| [Implementation status and release gates](./03-implementation-status.md) | Ordered work plan, external requirements, and evidence required before release |

## Product boundary

CorridorAudit reviews supplied invoices, payout records, and bank transaction records. It calculates differences, records evidence references, and presents findings for a person to review. It does not move money or submit bank claims. Automated model output is advisory. Deterministic calculations and explicit source evidence must govern financial amounts and control decisions.

The current development environment is local. A local run is useful for development and controlled synthetic-data evaluation. It is not a production deployment. Managed identity, database, queue, object storage, key management, provider accounts, network policy, monitoring, and backup configuration must be selected and provisioned before production operation.

## Documentation rule

Every implementation milestone must update these production records with what changed, the active limitations, configuration required, and the verification actually performed. Keep the existing application UI and workflow. Add controls and clarify labels without deleting existing feature areas.
