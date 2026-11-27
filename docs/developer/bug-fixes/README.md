# Bug Fixes — 2026-11-27

Individual root-cause analysis and fix documents for six production-affecting bugs fixed during hackathon submission preparation.

## Bug Fixes

| # | Bug | File | Status |
|---|-----|------|--------|
| 1 | SSE Status Invalid Tailwind Class | [`01-sse-status-tailwind.md`](./01-sse-status-tailwind.md) | ✅ Fixed |
| 2 | Settings GitHub Icon Overlap | [`02-settings-github-icons.md`](./02-settings-github-icons.md) | ✅ Fixed |
| 3 | Hot-Folder Never Re-ingests | [`03-hotfolder-reingest.md`](./03-hotfolder-reingest.md) | ✅ Fixed |
| 4 | Stale Production Bundle | [`04-stale-production-bundle.md`](./04-stale-production-bundle.md) | ✅ Fixed |
| 5 | Preview Format Race | [`05-preview-format-race.md`](./05-preview-format-race.md) | ✅ Fixed |
| 6 | CSV Negative Amounts as Text | [`06-csv-negative-amounts.md`](./06-csv-negative-amounts.md) | ✅ Fixed |

## Summary

All six fixes verified:
- `npm run typecheck` — clean
- `npm test` — 93/93 pass
- `npm run build` — success
- `git diff --check` — no whitespace errors

## Related Commits

- `1620cef` — fix: SSE status colors, settings icon spacing, and stale runtime issues (bugs 1–4)
- `c352359` — fix: preview format race, CSV negative amounts, and hot-folder re-ingest (bugs 3, 5, 6)

All commits on `main`, pushed to `origin/main`.