# Individual raw source examples

These are separate synthetic files in formats accepted by the Data Sources upload area. Upload one file at a time to demonstrate CSV, SWIFT MT103, and ISO 20022 ingestion.

Each raw file contains only the records for that source. The current app does not reliably join a separately uploaded invoice CSV to a later payout or statement file. Those uploads can therefore create separate cases with incomplete settlement evidence.

For a complete invoice-to-payment audit in one upload, use the individual paired JSON cases in ../upload-one-at-a-time instead. Do not upload both these raw examples and the paired JSON for the same transaction unless duplicate demo records are intended.
