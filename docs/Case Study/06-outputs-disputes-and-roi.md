# 06 · Review outputs and operational limits

## Current outputs

| Output | Current implementation | Boundary |
| --- | --- | --- |
| Case verdict | Status, calculated values, summary, provenance, and collected SourceRefs in the workbench and persisted SQLite record | Depends on input quality, configured model, and implemented rules |
| Reconciliation figures | Reference amount, estimated FX spread, known fees, tax, net settlement, and residual | A zero residual is a calculation result, not independent evidence authentication |
| Review breakpoint | Approve, reject with a note, or stop when the gate pauses | Does not send payments, open a bank dispute, or guarantee changed findings |
| Report | Text/JSON response through `/api/report/[caseId]` | Draft report only; inspect before external use |
| Raw-ingestion record | Original payload content, digest, parse status, metadata, linked case IDs; list/download/reprocess endpoints | Raw payload is plaintext SQLite content, and the record is not immutable evidence storage |

## Illustrative result

The synthetic example in [Module 01](./01-problem-statement.md) yields a USD 5,481.50 reference amount, USD 246.50 estimated FX difference, USD 45 listed deduction, USD 5,190 net settlement, and USD 0 residual under those assumptions. These figures are illustrative inputs, not measured user results or a verified rate observation.

The generated dispute text should be treated as a request for review based on submitted records. It is not legal analysis or a determination that a charge is unlawful or recoverable. A reviewer should verify the underlying contract, bank records, rate source, and applicable terms before sending any correspondence.

## No measured ROI claim

This repository does not contain a production benchmark comparing audit time, recovery rates, or fraud loss before and after deployment. The software has not established a “seconds per wire,” percentage recovery, or fraud-prevention guarantee. Operational performance and outcomes must be measured with an authorized, representative dataset and an agreed evaluation method.

## Deployment readiness

The project is a local preview. It lacks authentication/authorization, tenant isolation, durable distributed execution, complete provider connectors, credential refresh lifecycle, encrypted raw-payload storage, and production retention/backup/monitoring controls. Do not use it to process live financial instructions or unapproved personal or bank data.
