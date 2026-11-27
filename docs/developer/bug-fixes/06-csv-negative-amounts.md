# Bug Fix: CSV Export Negative Amounts Neutralized as Text

**Date:** 2026-11-27  
**Commit:** `c352359`  
**Files:** `src/core/reports/export-formats.ts`, `tests/report-exports.test.ts`

---

## Symptom

Negative financial amounts (e.g., `-35.00` for unexplained variance) were emitted as `'-35.00` (leading apostrophe) in CSV output. This neutralized the formula risk but broke spreadsheet `SUM()` because the cell became text.

---

## Root Cause

`csvEscape()` applied formula neutralization to any value starting with `= + - @`:

```typescript
const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
```

The `-` in `-35.00` matched, so a plain negative number was quoted.

---

## Fix

Only neutralize when the value is **not** a plain number:

```typescript
function csvEscape(value: string | number | undefined | null): string {
  const raw = value === undefined || value === null ? "" : String(value)
  const isPlainNumber = /^[+-]?\d+(?:\.\d+)?$/.test(raw)
  const safe = !isPlainNumber && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  if (/[",\r\n]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`
  }
  return safe
}
```

- `-35.00` → `-35.00` (numeric, summable)
- `=HYPERLINK("bad")` → `'=HYPERLINK("bad")` (neutralized)
- `+35.00` → `+35.00` (numeric)
- `@total` → `'@total` (neutralized)

---

## Regression Test

Added to `tests/report-exports.test.ts`:

```typescript
const negativeCsv = buildVerdictsCsv([{
  ...SAMPLE_VERDICT,
  caseId: "NEG-1",
  numbers: { ...SAMPLE_VERDICT.numbers, unexplainedVarianceMinor: -3500 },
}])
assert.match(negativeCsv, /,-35\.00,/)   // numeric
assert.doesNotMatch(negativeCsv, /,'-35\.00,/) // not text
```

---

## Verification

- `npm test` — 93/93 pass (new test passes)
- Manual CSV open in Excel/LibreOffice: negative cells are numeric, `SUM()` works
- TypeScript typecheck: clean