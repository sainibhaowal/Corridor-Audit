# CorridorAudit 2-Minute Demo & Judge Walkthrough

Follow these steps to run a complete end-to-end demonstration of **CorridorAudit**:

---

## 1. Start the Workbench
```bash
npm install
cp .env.example .env   # or Copy-Item .env.example .env on PowerShell
npm run dev            # opens at http://127.0.0.1:3000
```
Open `http://127.0.0.1:3000` and open **System Settings** (bottom-left) to paste any supported LLM key (NVIDIA NIM, Google Gemini, Groq, OpenRouter, OpenAI, Anthropic, or local Ollama) and verify model discovery. Once live, `Configure LLM Key` hides automatically and the workspace displays **`> Waiting for Data . . .`**.

---

## 2. Trigger an Audit via Sidebar Drag-and-Drop (or Click)
1. Under **Autonomous Triggers** in the left sidebar, **drag and drop** any `.csv`, `.txt` (SWIFT MT103), `.xml` (`camt.053`), `.json`, text-based `.pdf`, or receipt image (`.png`, `.jpg`, `.jpeg`, `.webp`) directly onto **`Upload source`** (or click **`Upload source`** to pick a file). Images automatically use your Vision LLM or fall back to local `tesseract.js` OCR.
2. Watch the **inline progress indicator** right below `Upload source`:
   - `Uploading <filename>...` → `Processing & indexing to Raw Vault...` → `Ingested (N) · Live agents running`
3. A **top toast** confirms Raw Data Vault storage and switches you automatically to **Live Agent Stream**.

---

## 3. Watch the 4+1 Concurrent Mozaik Agents
In **Live Agent Stream**:
- `TermsAgent`, `FxBenchmarkAgent`, `WireDetectiveAgent` (and `DuplicateAnomalyAgent` when duplicate/BEC triggers hit) run **concurrently** in isolated `CorridorState` slots.
- Once all specialists finish, `AuditorAgent` runs integer minor-unit balance verification and `SourceRef[]` citation checks.
- High-risk cases pause at **`SettlementGateInterceptionHandler`**: click **Approve**, **Reject & Steer**, or **Stop**.

---

## 4. Inspect, Preview & Export (`.pdf`, `.csv`, `.txt`, `.json`)
- Open **Corridor Summary** to explore the live **Trend Chart (Line / Area / Bar)**, **Stacked / Pie Leak Breakdown**, **Model & Agent Usage Meter**, **Case Risk Heat-Graph**, and **Trust & Accuracy Proof** scorecard, or click **Export Sheet (`.csv`)** / **Export All (`.json`)**.
- Open any completed case in the **Case Inspector** (or click **Preview Files** in the right-hand **Artifacts** drawer):
  - **Trace Waterfall (Gantt) Tab:** Inspect the parallel millisecond timeline proving the specialists ran concurrently before `AuditorAgent`.
  - **In-Built File Preview Tab:** View the live inline **`.pdf`** report (`<iframe>`), parsed **`.csv`** spreadsheet table, **`.txt`** review request draft, or **`.json`** audit payload without leaving the app.
- Open **Raw Vault** to inspect the SHA-256 fingerprint, encrypted storage status, or reprocess/download the original source payload.
