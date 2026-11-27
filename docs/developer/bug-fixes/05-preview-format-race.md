# Bug Fix: Case Inspector Modal Preview Format Race Condition

**Date:** 2026-11-27  
**Commit:** `c352359`  
**File:** `src/components/case-inspector-modal.tsx`

---

## Symptom

Switching the preview format tabs (PDF → CSV → TXT → JSON) briefly showed stale content from the previous format while the new fetch was in flight. For example, selecting CSV after PDF would render the PDF iframe content inside the CSV table area until the CSV response arrived.

---

## Root Cause

The `useEffect` keyed by `[activeTab, caseId, previewFormat]` did not clear `previewText` or `previewError` when `previewFormat` changed. Stale state persisted until the new fetch resolved.

---

## Fix

Added a `useRef` run counter that acts as a request ID:

```typescript
const previewEffect = useRef(0)

useEffect(() => {
  if (activeTab !== "preview" || !caseId) return
  const thisRun = ++previewEffect.current
  setPreviewLoading(previewFormat !== "pdf")
  setPreviewError(null)
  if (previewFormat === "pdf") {
    setPreviewText("")
    return
  }
  let cancelled = false
  fetch(`/api/report/${encodeURIComponent(caseId)}?format=${previewFormat}&preview=1`)
    .then(async (res) => { /* ... */ })
    .then((txt) => { if (!cancelled && thisRun === previewEffect.current) setPreviewText(txt) })
    .catch((err) => { if (!cancelled && thisRun === previewEffect.current) setPreviewError(...) })
    .finally(() => { if (!cancelled && thisRun === previewEffect.current) setPreviewLoading(false) })
  return () => { cancelled = true }
}, [activeTab, caseId, previewFormat])
```

Behavior:
- On format change, `thisRun` increments; any in-flight fetch from the old format sees `thisRun !== previewEffect.current` and discards its result
- `previewText`/`previewError` cleared immediately on format switch
- PDF format uses an `<iframe>` and does not trigger a text fetch

---

## Verification

- Manual UI test: rapid tab switching shows no stale content
- `npm test` 93/93 pass
- TypeScript typecheck: clean (added missing `useRef` import)