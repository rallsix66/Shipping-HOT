# R2 Manual Scope Acceptance Gapfill — 2026-10-26

## SHA binding (do not confuse)

| Label | SHA | Meaning |
| --- | --- | --- |
| **product baseline (OLD)** | `f87a2626239baf049e3e0e6a9da7bd7ef4aa8c9c` | Prior product baseline; **NOT** this batch's tested code |
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
| CN-P02 | Checklist; HTTPS entry metadata on catalog host (`www.sz.msa.gov.cn`); empty date OK; checked_empty; body reject (metadata-only) | Full article scrape / auto-fetch not in scope; no invented dates |
| VN-P01 | Checklist; HTTPS entry metadata on `vimawa.gov.vn`; empty/unknown date OK; checked_empty; body reject | TBHH id is not a date; auto-fetch not in scope |
| MY-P03 | Checklist; HTTPS entry metadata on `www.northport.com.my`; empty date; checked_empty; body reject | Disabled htmlIndexCandidate stays offline; stop auto this round |
| MY-L01 | Checklist; metadata save on exact catalog entry URL; empty `publishedAt` OK; date-only / invented midnight refused; body reject (metadata-only); shared URL → single entry + version bump | **Not** independent per-card persistence; no invented slug identity |
| PH-P01 | Checklist; HTTPS entry metadata on `www.ppa.com.ph` (advisory + port-news URLs); empty date; checked_empty; body reject | Do **not** install CA / disable TLS; prior BLOCKED TLS leaf preserved; auto-fetch not claimed |
| PH-W01 | www HTML entry metadata + checked_empty; empty date; body reject | **pubfiles PDF host rejected**; no PDF fetch; not "all PDFs enterable"; historical empty/limited OK retained (not rewrite as parse-never-succeeded) |
| PH-W02 | Same as PH-W01 for www weather-advisory entry | Same PDF limitation; historical empty-state auto-recognize retained |
| XX-F01 | Checklist + metadata path + empty + checked_empty + body reject | Access risk unchanged — catalog wire-in only; login/JS may block humans; site access / full content not accepted |
| MY-P02 | Checklist; catalog HTTPS entry/feed URLs wired; empty titles must not be forged valid; checked_empty; body reject | **Not** tech-cannot-fetch (historical 200s); keep R2-5 limited PASS + R2-4 STALE; auto product usability unresolved |
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
