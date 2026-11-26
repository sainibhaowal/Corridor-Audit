# 06 · Actionable Outputs, Bank Dispute Letters & ROI

## 1. What Every User & Finance Team Receives

| Output Deliverable | Format | Who Uses It & Why |
| :--- | :--- | :--- |
| **1. Forensic Verdict & Summary** | JSON + UI Card | B2C & B2B operators see immediately whether a payout is `CLEAN`, `RECOVERABLE_FEE_VIOLATION`, `FX_SPREAD_ALERT`, `DUPLICATE_RISK`, or `BEC_BANK_CHANGE_RISK`. |
| **2. Cent-Proof Accounting Ledger** | Integer Minor Units | Controllers & bookkeepers get exact ECB baseline, FX spread (bps + USD/EUR), fees, tax, and `$0.00` variance proof. |
| **3. Ready-to-Send Dispute Letter** | `.txt` & `.json` (`GET /api/report/[caseId]`) | Cites exact SWIFT MT103/camt.053 field tags (`:71A:OUR`, `:71G:`, `:36:`) and ECB historical rate so banks/clients refund wrongful deductions. |
| **4. Immutable `SourceRef` & Raw Vault** | SHA-256 + Raw File | Auditors can trace every figure to the exact raw line and re-download or re-process the original payload at any time. |

---

## 2. Worked End-to-End Example Output (`INV-2041`)

- **Verdict Status:** `RECOVERABLE_FEE_VIOLATION`
- **ECB Benchmark (`2026-11-24`):** `1.0963` → Expected **`$5,481.50`**
- **Hidden FX Spread Loss:** **`$246.50`** (`449.7 bps`)
- **Recoverable `:71A:OUR` Fee:** **`$45.00`**
- **Unexplained Variance:** **`$0.00`** (100% cent-proved)
- **Optimal Transparent Rail Replay:** `$291.50` total corridor leakage (`5.32%`)

```text
SUBJECT: Formal Fee Recovery Claim — SWIFT MT103 TXN-2026-0041 / Invoice INV-2041 ($45.00)

Per Invoice INV-2041 and SWIFT field :71A:OUR, the remitter contracted to bear all
correspondent and beneficiary lifting fees.

Evidence Citations:
- [:71A:] Contracted & Wire Charge Bearer = OUR
- [:71G:] Receiver/Intermediary Charges Deducted = USD 45.00
- [:32A:] Net Credited Amount = USD 5,190.00 (Value Date: 2026-11-24)
- [:36:]  Bank Applied Rate = 1.0470 vs. Official ECB Rate = 1.0963 (-$246.50 FX spread)

Requested Action: Credit USD 45.00 to beneficiary account to restore full OUR settlement.
```

---

## 3. Business & Operational ROI

| Metric | Manual Spreadsheet Reconciliation | CorridorAudit (Mozaik 4+1) |
| :--- | :--- | :--- |
| **Time per Cross-Border Wire** | 15–30 minutes (manual ECB lookup + PDF/MT103 check) | **< 5 seconds** (4 parallel specialists + reactive auditor) |
| **`:71A:OUR` Fee Recovery** | Often missed or written off | **100% flagged & paused** with pre-drafted dispute letter |
| **Hidden FX Markup Visibility** | Invisible in standard bank statements | **Quantified in bps & cents** vs. historical ECB rate |
| **BEC / Duplicate Protection** | Caught after funds are lost | **Paused at `SettlementGateInterceptionHandler`** before close |
| **Audit Trail** | Fragile local spreadsheets | **SHA-256 Raw Data Vault + field-level `SourceRef`s** |
