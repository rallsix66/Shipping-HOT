# R2 raw bytes / encoding closeout — 2026-10-12

- Code SHA: `b8528e9494f4e3706b01dc0e0cce7def59887bd3`; clean before gates. Evidence-only changes after this SHA do not stand in for the tested code.
- Real skill loaded: `C:/Users/Administrator/.codex/skills/neat-freak/SKILL.md` v3.0.0, plus `references/verification.md`. Full path used because project `.agents/skills` does not exist. Actual bundled project inventory ran with Git Bash, raw exit 0; it enumerated rules, Markdown, workspace/worktrees and residue. Inventory is not a security audit.

## Verification

- `summary.txt` and separate UTF-8 logs record command, full SHA, start time, stdout, stderr and raw exit. Node v24.15.0; `SHIPPING_DATA_MODE=mock`; `npm_config_store_dir=D:/.pnpm-store` matches existing installation metadata. Install ran normal prepare successfully (no ignore-scripts or native-module copying).
- install/build/typecheck/lint: exit 0. Feed/security/encoding/article/registry targeted: 8 files, 71 passed. Intel targeted: 46 passed; paid-receipt/translation targeted: 114 passed. Full suite: 103 files, 902 passed, 3 skipped. P0 native / P2C runtime / P3 Feed smoke: exit 0, their own isolated databases.
- New 11 tests: decoder 6 plus transport 5 (three parameterized legacy-byte Feed+intel chains, byte cap, HTML Feed/UTF-8 article). GBK/TIS-620/windows-1258 byte sequences are synthetic hex fixtures, not UTF-8 text mislabeled as legacy. Windows-1258 combining hook-above is asserted without Unicode normalization. Unknown/damaged bytes retain previous Feed and intel rows.
- Preliminary targeted runs exposed mistakes in new assertions (`url` instead of Feed `sourceUrl`; version `source_updated_at` is stored in SQLite rather than projected by `listItems`). Fixed assertions now inspect the actual persisted field. Those exploratory failures are not claimed as final gate results.
- Preliminary sandbox install could not write the Git hook despite raw exit 0; not accepted as install PASS. Final elevated install log shows successful normal prepare. Default sandbox pnpm store differed from existing metadata; final run explicitly inherited the existing store location. No dependency/lockfile changes.
- Browser/S7: NOT_RUN, no UI/route changes. Upstream/live/paid/LLM calls: NOT_RUN; no source probing performed. New transport tests replace Node request with an in-memory mock (no socket), and intel uses an in-memory SQLite database. Counters or grep alone are not claimed as proof of no network.

## Knowledge and workspace matrix

| Surface | Status | Evidence / action |
| --- | --- | --- |
| Code | verified-current | Raw bytes in default transport; one bounded decoder; existing feed parser and safety policies reused; tests above. No schema, dependency, provider or scheduling change. |
| Runtime | pending | No live source verification or deployment. Synthetic compatibility only; no claim of P1 coverage or R2 completion. |
| Docs | changed-and-verified | Existing Feed safe-fetch plan now documents encoding priority, conflict metadata, strict failures, 4096-byte declaration scan, Unicode preservation and limitations. Status records tested SHA and leaves review pending. |
| Architecture / ADR | verified-current for slice | ADR-007/008/009 boundaries unchanged; same Nitro/SQLite/runtime/provider-free reads. No new architecture decision required. |
| Rules | verified-current for scope; historical drift pending | AGENTS read, actual rule chain inventoried. Its older R1.5 headline and historical 0/10/VNSGN BLOCKED prose coexist with later decisions; this slice does not rewrite historical acceptance. Latest status decision remains authoritative. |
| Roadmap | verified-current for scope | Only encoding subset of R2-1 addressed. Source CA, web/json list/date support, registry/GET wiring and real-source acceptance remain pending. No stale encoding TODO remains in the active slice plan. |
| Memory | out-of-scope | No memory writes or invented secondary authority. |
| Workspace | verified-current for reviewed scope | Only explicit implementation/docs/evidence files committed. Retained databases, secrets, old `.tmp` artifacts, screenshots and third-party archives not staged or removed. Inventory status entry during gates was the newly generated evidence directory. |

- Secret/network scans retain original scope and raw exits (secret scan 1 = no match). New decoder/tests were additionally read in full; only synthetic constants, no credentials. These checks do not certify historical archives as secret-free; historical embedded third-party key/cookie cleanup is outside this slice.
- Existing warnings remain: duplicate auto-imports, large bundle chunks, outdated Browserslist data, Windows symlink skips. No threshold/test weakened.
- Review: pending parent review. Merge/deploy/live: NOT_RUN. No cleanup performed; review evidence and existing residue retained. No deletion authorization requested or assumed.
