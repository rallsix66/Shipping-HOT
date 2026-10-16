# R2 approved migration 026 and web-list persistence closeout

Date: 2026-10-12. Final tested code SHA: `8cbf8343444b62c0bb06f59a249cefc74f404caf`; implementation commit: `1f12ce1528c82aace4a2839bbda00a078c2b9c5e`. Worktree clean before final gates. Evidence/status-only commit follows; it must not be described as the tested code SHA.

## Verification

- Local gate PASS: install, build, typecheck, lint, targeted sets, full suite, P0 native restart, P2C runtime and P3 Feed freshness smoke exit 0. Node 24.15.0. Web-list 42/42 (35 parser + 7 integration); intel 88/88; full suite 105 files / 944 passed / 3 skipped. See summary.txt and individual UTF-8 logs for command, SHA, stdout/stderr and raw exit.
- First gate on 1f12ce1 failed one translation test that still asserted schema 25. Changed only that assertion to 26, then repeated the full gate on clean 8cbf834. Original failed evidence is retained in gate-1f12ce1.
- Populated v25 migration preserves source values/IDs/health, existing item/version/run rows, nullable old evidence, custom index/trigger and an incoming ON DELETE CASCADE FK child. Repeated initialization, rollback after injected DDL failure, FK-check refusal and enforcement restoration are tested. RSS collection reuses the old hash/version.
- Existing NCHMF archived HTML bytes pass injected transport and public-address lookup through secureFetchArticle/decoder/fromHtml to SQLite: five items; Vietnamese title, detail URL, timestamp and configured timezone basis verified. Reopen a newly created .tmp database and verify date evidence/repeated collection. No sockets are opened by these injected transport fixtures. The archive is historical evidence, not a current live-source test.
- Synthetic tests cover date-only corrections/basis changes/A-to-B-to-A reuse, explicit legal empty state, parse/decode/private-address failures, missing config before network, and transactional version-write failure preserving old items/versions/evidence.
- Inventory and usage counters alone are not evidence of no external calls. This slice's offline proof is the injected lookup/transport and isolated databases. Dependency install and GitHub operations are separate from business-provider live activity.

## Neat Freak fact matrix

Applied the actual installed neat-freak v3.0.0 skill and its verification reference. Ran its bundled read-only inventory through Git Bash (exit 0); inventory is not a security audit.

| Surface | State | Action/evidence |
| --- | --- | --- |
| Code | verified-current | 026, migration runner, source kind/config, collector, repository and isolated tests reviewed; previous migrations unchanged. |
| Runtime | pending / NOT_RUN live | Isolated tests and smoke verified only. Retained databases not opened for migration; no dev/start/server switch. |
| Docs | changed-and-verified | Architecture, existing web-list plan and status now reflect the user's 12:11:25 UTC approval, implementation and actual gate. Historical failed/earlier parser evidence retained as history. |
| Rules/ADR | verified-current | Explicit authorization resolves Confirm Before for 026. ADR-007/008 architecture unchanged, ADR-009 weather scope untouched; no new ADR needed. Single main-push workflow preserved; stacked PR8 base retained. |
| Memory | out-of-scope | No memory writes. Current instructions/repository are authority. |
| Workspace | verified-current for commit scope | Reviewed paths only; no secret, retained DB, copied third-party archive or temp database staged. Test .tmp directories and existing residue remain for review; nothing deleted. |

No new TODO/FIXME in the changed implementation/test. No second parser, fetcher, queue, budget, workflow or E2E harness. No new production source or registry/GET connection. Sources remain catalog-bound. Parser/date rules and upstream attribution were not widened in this slice.

Code/docs whitespace check excluding raw evidence: PASS. Full diff check reports only tool-emitted trailing spaces in build logs; those raw bytes are intentionally preserved. Secret-pattern scan exit 1 = no match in recorded scope, not a repository-wide security guarantee. Existing auto-import, bundle/Browserslist, experimental-loader warnings and three Windows symlink test skips remain.

Parent review NOT_RUN/pending. R2 overall not PASS. Browser/S7 NOT_RUN (no UI/routes). Live/paid/LLM, CA/json_list, R3, merge/deploy NOT_RUN or out-of-scope. Branch CI has no runs by policy, not CI PASS. Review artifacts retained; no cleanup requested or performed.
