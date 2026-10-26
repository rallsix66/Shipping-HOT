# R2 Manual Scope Acceptance Gapfill — 2026-10-26

## SHA binding (do not confuse)

| Label | SHA | Meaning |
| --- | --- | --- |
| **product baseline (OLD)** | ``353886d1ff7270a6d6bff3c95ccc3c86259f6a28`` | Prior product baseline; **NOT** this batch's tested code |
| tip before this gapfill | `87002b85cdc1827a5dacee6af4ec7261e0176a7a` | Isolation tip when gapfill started |
| **this batch tested SHA** | `353886d1ff7270a6d6bff3c95ccc3c86259f6a28` | Code under test for this acceptance-gap fill |

Product file SHA-256 hashes (pre-commit): see `product-file-hashes.json`.

## Claim (bounded)

**9 entry wire-in; per-item verified capabilities AND limitations.**
Do **not** promote catalog presence or site accessibility into "accepted full content availability".

## What changed this round

1. **MY-L01** — Focus + gate: whole-page manual record + version updates on the shared catalog entry URL (`/service-update`). Saving by `sourceId+canonicalUrl` collapses cards into revisions of **one** record. **No** invented slug / per-card identity. Without trusted timezone-aware publish time, leave `publishedAt` empty (date-only / midnight invent refused).
2. **PAGASA (PH-W01 / PH-W02)** — Only www-host HTML entry URL(s) allowed for metadata + `checked_empty`. **pubfiles PDF host remains outside save permission** (reject). No domain expand, no PDF fetch. Documented as functional limitation.
3. **Migration upgrade test** — True old **v29** fixture with the 9 catalog rows deleted → isolated **030** upgrade: seed 9 rows, repeat migration idempotent, preserve unrelated sources/entries/versions. Covers 9-item path + MY-L01 shared URL + disallowed PDF host reject + empty/date-only.
4. **SHA / gate binding** — Old `f87a262` labeled baseline; this batch binds candidate tree + product file hashes + final code commit.

## Per-item verified capabilities vs limitations

| ID | Capabilities verified | Limitations (not claimed) |
| --- | --- | --- |
| MY-L01 | Checklist; metadata save on exact catalog entry URL; empty `publishedAt` OK; date-only / invented midnight refused; body reject (metadata-only); shared URL → single entry + version bump | **Not** independent per-card persistence; no invented slug identity |
| MY-L02 | Checklist; metadata; empty date; checked_empty; body reject | Full article scrape / auto-fetch not in scope |
| MY-L03 | Same as L02 path | Same |
| MY-L04 | Same | Same |
| MY-F01 | Same | Same |
| PH-W01 | www HTML entry metadata + checked_empty; empty date; body reject | **pubfiles PDF host rejected**; no PDF fetch; not "all PDFs enterable" |
| PH-W02 | Same as PH-W01 for www entry | Same PDF limitation |
| PH-F01 | Checklist + metadata path + empty + checked_empty + body reject | Full feed automation not claimed |
| XX-F01 | Checklist + metadata path + empty + checked_empty + body reject | **待接入访问** unchanged — catalog wire-in only; site access not accepted |

## Tests

- File: `server/intel/manual-scope-gapfill-20261026.test.ts`
- Cases: v29→030 seed+idempotent+preserve; 9-item path; MY-L01 shared URL revisions; PAGASA PDF host reject + date-only refuse
- Log: `.tmp/gapfill-acceptance-20261026/vitest-final.log` (4/4 pass)

## Constraints held

- Zero new source HTTP
- day20-20261026a untouched (worker 82336 / parent 27916 / host 15112)
- Manual 9 stay manual (no auto-fetch)
- Isolation branch ordinary push only; no merge/deploy/force

## Full local gate

- install/build/typecheck/lint/Vitest: **PASS**
- Vitest: 162 files; 2059 passed | 9 skipped (2068)
- Logs: .tmp/gate-manual-scope-gapfill-20261026/
- S7 harness: NOT_RUN_NOT_REQUIRED
