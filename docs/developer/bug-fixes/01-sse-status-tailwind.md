# Bug Fix: SSE Status Invalid Tailwind Class

**Date:** 2026-11-27  
**Commit:** `1620cef`  
**File:** `src/components/corridor-workspace.tsx` (lines 791, 1473)

---

## Symptom

The disconnected-state dot for the SSE stream and the footer "Runtime connected / Reconnecting" indicator rendered as invisible elements in production builds. The Tailwind class `bg-[#2c2111]0` is not valid syntax — the trailing `0` is not part of any color scale.

---

## Root Cause

Copy-paste error when authoring the disconnected color. The intention was a muted amber/orange dot for the disconnected state.

---

## Fix

```diff
- sseConnected ? "bg-emerald-600" : "bg-[#2c2111]0",
+ sseConnected ? "bg-emerald-600" : "bg-amber-600",
```

Applied at two locations:
1. **Header status row** (line 791): "SSE Stream Active / SSE Reconnecting..."
2. **Footer status bar** (line 1473): "Runtime connected / Reconnecting"

---

## Verification

- `npm run build` — no Tailwind purge warnings
- Visual inspection: disconnected state shows amber dot, connected shows emerald
- TypeScript typecheck: clean
- `npm test` — 93/93 pass