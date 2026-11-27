# Bug Fix: Hot-Folder Watcher Never Re-ingests Updated Files

**Date:** 2026-11-27  
**Commits:** `1620cef`, `c352359`  
**File:** `src/runtime/orchestrator.ts` (lines 50–125)

---

## Symptom

Dropping an updated file with the same filename into `data/inbox/` was silently ignored. The watcher's `seenFiles` `Set` only tracked filenames, so a second `change` event for the same name was deduplicated even though the file content changed.

---

## Root Cause

The original implementation used a `Set<string>` populated on first sight of a filename. No mechanism existed to detect file modification or to re-arm after a legitimate re-drop.

---

## Fix

Changed `seenFiles` to a `Map<string, string>` where the value is a signature `${mtimeMs}:${size}`:

```typescript
// Before
const seenFiles = new Set<string>()
// ...
if (!filename || seenFiles.has(filename)) return
// ...
seenFiles.add(filename)

// After
const seenFiles = new Map<string, string>()
// ...
if (!filename) return
const fullPath = resolve(hotFolder, filename)
let stats
try { stats = statSync(fullPath) } catch { return }
if (!stats.isFile()) return
const signature = `${stats.mtimeMs}:${stats.size}`
if (seenFiles.get(filename) === signature) return
seenFiles.set(filename, signature)

// Inside the debounced handler, re-verify before processing
const current = statSync(fullPath)
if (`${current.mtimeMs}:${current.size}` !== signature) return
```

Additional hardening:
- Skip directories and non-files via `stats.isFile()`
- Re-verify signature after the 250 ms debounce to avoid partial writes
- No longer calls `existsSync` before `statSync` (single syscall)

---

## Verification

- Manual test: drop `test.csv` → ingested; edit and re-drop → ingested again with new `ingestionId`
- `npm test` — 93/93 pass (includes ingestion and hot-folder tests)
- TypeScript typecheck: clean
- `npm run build` — success