# Bug Fix: Stale Production Bundle Served by `scripts/start.mjs`

**Date:** 2026-11-27  
**Commit:** `1620cef`  
**File:** `scripts/start.mjs`

---

## Symptom

After pulling latest code and running `npm start`, the server served a previously built `.next` bundle instead of rebuilding. The runtime status endpoint reported `sourceRevision` from an old commit and `workingTree: "modified"`.

---

## Root Cause

The start script only built when `.next/BUILD_ID` was missing:

```javascript
if (!existsSync(resolve(process.cwd(), ".next/BUILD_ID"))) {
  await runCommand(process.execPath, [nextCli, "build"])
}
```

It did not compare source mtimes against the build artifact.

---

## Fix

Added `bundleIsStale()` that computes the newest mtime across all tracked source inputs and compares it to the `BUILD_ID` mtime:

```javascript
const SOURCE_INPUTS = [
  "src", "public", "next.config.mjs", "package.json",
  "tailwind.config.ts", "postcss.config.mjs", "tsconfig.json"
]

function newestMtimeMs(target) { /* recursive directory walk */ }

function bundleIsStale() {
  const buildIdPath = resolve(process.cwd(), ".next/BUILD_ID")
  if (!existsSync(buildIdPath)) return true
  const builtAt = statSync(buildIdPath).mtimeMs
  return SOURCE_INPUTS.some(input => newestMtimeMs(resolve(process.cwd(), input)) > builtAt)
}
```

The build message now distinguishes first run vs. rebuild:

```javascript
console.log(firstRun
  ? "Building CorridorAudit Next.js production bundle (first run)..."
  : "Rebuilding CorridorAudit (sources changed since the last build)...")
```

---

## Verification

- Edit `src/components/corridor-workspace.tsx` → `npm start` → rebuild triggers → `sourceRevision` updates
- No rebuild when sources unchanged (verified by mtime comparison)
- `npm run build` passes
- `npm test` 93/93 pass