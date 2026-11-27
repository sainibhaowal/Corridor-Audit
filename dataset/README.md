# CorridorAudit demo dataset

This pack contains five synthetic, app-ready settlement cases for a judge walkthrough. All names, invoice and transaction references, amounts, account aliases, rates, and evidence excerpts are invented. They are not records from real people, businesses, banks, or providers.

## Upload individual cases

1. Start CorridorAudit and open **Data Sources**.
2. Open the dataset/upload-one-at-a-time folder.
3. Drag one JSON file into the upload area.
4. After it is processed, upload the next file and inspect its agent trace, verdict, and source references.

Each JSON file is one complete CorridorAudit case, pairing an invoice record with a separately identified payout or bank record where evidence exists. Source references identify those different record types and include synthetic excerpts. These are app-ready demonstration fixtures, not authenticated provider files.

The root-level corridor-audit-demo-cases.json is an optional batch containing the same five cases. Use either the individual files or the batch file, not both, unless you intentionally want duplicate demo cases.

| Case | Scenario | Intended review signal |
| --- | --- | --- |
| DEMO-2026-001 | Wise EUR payout with stated platform fee | Explained net settlement |
| DEMO-2026-002 | OUR bank transfer with receiver-side fee | Potential OUR fee violation |
| DEMO-2026-003 | Two same-value bank entries for one invoice | Possible duplicate |
| DEMO-2026-004 | USD-to-EUR payout with illustrative applied rate | FX and fee comparison |
| DEMO-2026-005 | QuickBooks-style invoice without payment evidence | Incomplete evidence |

Rates and excerpts are illustrative. Live benchmark results can vary with the configured FX service. Flags are review signals, not proof of a bank error, fraud, or recoverable funds.
## Separate raw-source examples

The provider-source-files subfolder has individually uploadable Wise and Stripe CSV files, an invoice CSV, a bank statement CSV, an MT103 text message, and a CAMT.053 XML statement. These contain source-only records, so uploading them produces separate source cases and does not guarantee matching across files. Use the paired case JSON files when you want a complete invoice-to-payment audit.

