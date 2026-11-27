# 01 · Problem statement

## Product problem

Cross-border settlement records are split across invoices, payment instructions, bank statements, and platform exports. A reviewer may need to compare the agreed amount and fee bearer with the amount credited, account for currency conversion, and trace the evidence used in the review.

CorridorAudit is a prototype for organizing that review. The repository contains parsers and analysis logic for supported input formats; it does not establish how often a loss occurs in the market. Percentages and dollar amounts in this case study are illustrative examples, not measured customer outcomes or bank claims.

## Review scenarios represented in the data model

| Scenario | Evidence to compare | Prototype analysis |
| --- | --- | --- |
| FX difference | Instructed amount, settlement amount, value date, and disclosed applied rate | Compare an estimated conversion with a Frankfurter/ECB reference rate when available |
| Fee-bearer difference | Invoice clause, wire charge bearer, and listed deductions | Surface recorded receiver and repair fees for review |
| Short payment or missing reference | Invoice and wire references, amounts, dates, and currencies | Apply the implemented matching and residual calculations |
| Duplicate or account change | Multiple supplied records and prior account reference, when present | Run deterministic heuristics and flag a case for operator review |

These checks depend on the submitted fields. They do not connect to an authoritative bank ledger, establish fraud, or decide legal recoverability.

## Illustrative arithmetic

Assume a synthetic EUR 5,000 payment, an illustrative ECB reference rate of 1.0963 USD/EUR, an illustrative bank rate of 1.0470, and a USD 45 deduction:

- Reference amount: EUR 5,000 × 1.0963 = USD 5,481.50.
- Amount at the disclosed bank rate: EUR 5,000 × 1.0470 = USD 5,235.00.
- After the listed USD 45 fee: USD 5,190.00 net.
- Estimated rate difference: USD 246.50; total difference from the reference amount: USD 291.50.

The values are synthetic and do not represent a verified transaction, rate observation, unlawful fee, or guaranteed recovery. A recorded `OUR` clause may support a request for review; any entitlement depends on the governing agreement and applicable rules.

## Intended users

The case model can represent freelancer/platform payouts and business invoice/wire records. The current UI is one local review workbench, not separate production B2C and B2B products. Current connector coverage and operational limits are listed in [Data ingestion and integrations](./02-data-ingestion-and-raw-vault.md).
