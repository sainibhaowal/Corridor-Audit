# Bug Fix: Settings Sidebar GitHub Icon Overlap

**Date:** 2026-11-27  
**Commit:** `1620cef`  
**File:** `src/components/settings-view.tsx` (line 363)

---

## Symptom

The absolute-positioned GitHub repository and issues links (`right-2 bottom-2`) overlapped the last settings tile ("Team & Webhook Security") because the parent `Card` only had `p-3` padding (12 px), insufficient for the 16×16 icons with 4 px gap.

---

## Root Cause

The sidebar `Card` did not reserve space for the fixed-position icon cluster.

---

## Fix

```diff
- <Card className="relative flex flex-col gap-1 p-3">
+ <Card className="relative flex flex-col gap-1 p-3 pb-10">
```

The `pb-10` (40 px) provides adequate clearance for the icon row.

---

## Verification

- Visual inspection at mobile (`lg:` breakpoint) and desktop widths
- No layout shift on settings tab navigation
- TypeScript typecheck: clean
- `npm test` — 93/93 pass