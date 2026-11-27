# 2026-11-27 UI Runtime Bug Fixes & Report Export Hardening

## Summary

Six production-affecting UI/runtime/export bugs fixed during hackathon submission preparation.

---

## 1. SSE Status Indicators — Invalid Tailwind Class

**File:** `src/components/corridor-workspace.tsx` (lines 791, 1473)

### Symptom
Disconnected-state dot for SSE stream and footer "Runtime connected / Reconnecting" indicator rendered invisible in production builds. Class `bg-[#2c2111]0` is not valid Tailwind syntax.

### Fix
```diff
- sseConnected ? "bg-emerald-600" : "bg-[#2c2111]0",
+ sseConnected ? "bg-emerald-600" : "bg-amber-600",
```
Applied at two locations: header status row (line 791) and footer status bar (line 1473).

---

## 2. Settings Sidebar — GitHub Icon Overlap

**File:** `src/components/settings-view.tsx` (line 363)

### Symptom
Absolute-positioned GitHub repository and issues links (`right-2 bottom-2`) overlapped the last settings tile ("Team & Webhook Security"). Parent `Card` only had `p-3` padding (12 px).

### Fix
```diff
- <Card className="relative flex flex-col gap-1 p-3">
+ <Card className="relative flex flex-col gap-1 p-3 pb-10">
```
The `pb-10` (40 px) provides adequate clearance for the icon row.

---

## 3. Hot-Folder Watcher — Stale `seenFiles` Set Never Re-arms

**File:** `src/runtime/orchestrator.ts` (lines 50–125)

### Symptom
Dropping an updated file with the same filename into `data/inbox/` was silently ignored. The watcher's `seenFiles` `Set` only tracked filenames.

### Fix
Changed `seenFiles` from `Set<string>` to `Map<string, string>` keyed by filename with values of `${mtimeMs}:${size}`:

```typescript
// Before
const seenFiles = new Set<string>()
if (!filename || seenFiles.has(filename)) return
seenFiles.add(filename)

// After
const seenFiles = new Map<string, string>()
if (!filename) return
const fullPath = resolve(hotFolder, filename)
let stats
try { stats = statSync(fullPath) } catch { return }
if (!stats.isFile()) return
const signature = `${stats.mtimeMs}:${stats.size}`
if (seenFiles.get(filename) === signature) return
seenFiles.set(filename, signature)

// Inside debounced handler, re-verify before processing
const current = statSync(fullPath)
if (`${current.mtimeMs}:${current.size}` !== signature) return
```

Additional hardening: skip directories/non-files; re-verify signature after 250 ms debounce to avoid partial writes.

---

## 4. Stale Production Bundle — `scripts/start.mjs` Served Old `.next`

**File:** `scripts/start.mjs`

### Symptom
After pulling latest code and running `npm start`, server served previously built `.next` bundle. Runtime status reported old `sourceRevision` and `workingTree: "modified"`.

### Fix
Added `bundleIsStale()` comparing newest source mtime against `BUILD_ID` mtime:

```javascript
const SOURCE_INPUTS = [
  "src", "public", "next.config.mjs", "package.json",
  "tailwind.config.ts", "postcss.config.mjs", "tsconfig.json"
]

function bundleIsStale() {
  const buildIdPath = resolve(process.cwd(), ".next/BUILD_ID")
  if (!existsSync(buildIdPath)) return true
  const builtAt = statSync(buildIdPath).mtimeMs
  return SOURCE_INPUTS.some(input => newestMtimeMs(resolve(process.cwd(), input)) > builtAt)
}
```

Build message distinguishes first run vs. rebuild:
```javascript
console.log(firstRun
  ? "Building CorridorAudit Next.js production bundle (first run)..."
  : "Rebuilding CorridorAudit (sources changed since the last build)...")
```

---

## 5. Case Inspector Modal — Preview Format Race Condition

**File:** `src/components/case-inspector-modal.tsx`

### Symptom
Switching preview format tabs (PDF → CSV → TXT → JSON) briefly showed stale content from previous format while new fetch was in flight.

### Fix
Added `useRef` run counter that clears state on format change and ignores stale fetch responses:

```typescript
const previewEffect = useRef(0)

useEffect(() => {
  if (activeTab !== "preview" || !caseId) return
  const thisRun = ++previewEffect.current
  setPreviewLoading(previewFormat !== "pdf")
  setPreviewError(null)
  if (previewFormat === "pdf") { setPreviewText(""); return }
  let cancelled = false
  fetch(`/api/report/${encodeURIComponent(caseId)}?format=${previewFormat}&preview=1`)
    .then(async (res) => { /* ... */ })
    .then((txt) => { if (!cancelled && thisRun === previewEffect.current) setPreviewText(txt) })
    .catch((err) => { if (!cancelled && thisRun === previewEffect.current) setPreviewError(...) })
    .finally(() => { if (!cancelled && thisRun === previewEffect.current) setPreviewLoading(false) })
  return () => { cancelled = true }
}, [activeTab, caseId, previewFormat])
```

---

## 6. CSV Export — Negative Amounts Neutralized as Text

**Files:** `src/core/reports/export-formats.ts`, `tests/report-exports.test.ts`

### Symptom
Negative financial amounts (e.g., `-35.00`) emitted as `'-35.00` (leading apostrophe) in CSV, breaking spreadsheet `SUM()`.

### Root Cause
`csvEscape()` neutralized any value starting with `= + - @`:
```typescript
const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
```

### Fix
Only neutralize when value is **not** a plain number:
```typescript
function csvEscape(value: string | number | undefined | null): string {
  const raw = value === undefined || value === null ? "" : String(value)
  const isPlainNumber = /^[+-]?\d+(?:\.\d+)?$/.test(raw)
  const safe = !isPlainNumber && /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw
  if (/[",\r\n]/.test(safe)) return `"${safe.replace(/"/g, '""')}"`
  return safe
}
```

- `-35.00` → `-35.00` (numeric, summable)
- `=HYPERLINK("bad")` → `'=HYPERLINK("bad")` (neutralized)
- `+35.00` → `+35.00` (numeric)
- `@total` → `'@total` (neutralized)

### Regression Test
```typescript
const negativeCsv = buildVerdictsCsv([{ ...SAMPLE_VERDICT, caseId: "NEG-1", numbers: { ...SAMPLE_VERDICT.numbers, unexplainedVarianceMinor: -3500 } }])
assert.match(negativeCsv, /,-35\.00,/)   // numeric
assert.doesNotMatch(negativeCsv, /,'-35\.00,/) // not text
```

---

## Verification Summary

| Check | Result |
|-------|--------|
| `npm run typecheck` | ✅ Clean |
| `npm test` | ✅ 93/93 pass |
| `npm run build` | ✅ Success |
| `git diff --check` | ✅ No whitespace errors |
| Runtime status (`/api/runtime/status`) | ✅ Reports `sourceRevision: c3523593bcb8`, `workingTree: "clean"` |
| SSE indicators | ✅ Amber disconnected / Emerald connected |
| Settings icons | ✅ No overlap at any breakpoint |
| Hot-folder re-drop | ✅ Re-ingests on mtime/size change |
| `npm start` rebuild | ✅ Triggers when sources newer than `.next` |
| Preview tab switch | ✅ No stale content |
| CSV negative amounts | ✅ Numeric in spreadsheets |

---

## Related Commits

| Commit | Message |
|--------|---------|
| `a5d2799` | feat: report exports, workspace-scoped audit trail, and auth hardening |
| `1620cef` | fix: SSE status colors, settings icon spacing, and stale runtime issues |
| `c352359` | fix: preview format race, CSV negative amounts, and hot-folder re-ingest |

All commits on `main`, pushed to `origin/main` (public: `github.com/sainibhaowal/Corridor-Audit`).