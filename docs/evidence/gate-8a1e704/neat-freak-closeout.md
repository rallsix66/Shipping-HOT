# JSON numeric identity P2 closeout - 2026-10-13

Code SHA `8a1e7044e5baad45265cce31cc696d8a613ed13f`, clean before gates. Scope is solely the parent-reported unsafe numeric template identity defect. Large JSON numbers could round to the same Number/URL and be silently deduplicated. renderTemplate now requires Number.isSafeInteger for numbers; large identities must arrive as strings. No bigint parser or migration added.

Original JSON text (not JS objects/stringify) carries IDs 9007199254740992 and 9007199254740993 through the collector. The run fails with parse_failed and zero committed entries; previous item/version rows remain unchanged and source health is failing. Quoted string forms then produce two distinct canonical URLs and DB item IDs. Unit coverage includes both safe integer limits, zero, ordinary integer, unsafe positive/negative, fraction, NaN and Infinity.

Local gate PASS: JSON 49/49 (42 parser + 7 integration), intel 137/137, web-list 42/42, full suite 107 files / 993 passed / 3 skipped. Install/build/typecheck/lint, other targeted suites and three isolated smoke commands exit 0. Raw UTF-8 command/full SHA/stdout/stderr/exit evidence is preserved here. Original 47/991+3 evidence remains unchanged as pre-repair history.

Applied the actual installed Neat Freak skill and verification reference previously loaded in this conversation; actual bundled Git Bash inventory exit 0. Inventory is not a security audit.

| Surface | State | Finding/action |
| --- | --- | --- |
| Code | verified-current | Two-line numeric guard, two regression cases; full gate. |
| Runtime | pending live | Only isolated test/smoke DBs; no retained DB, live or paid call. |
| Docs | changed-and-verified | Existing JSON contract and status identify the P2 repair and code-SHA evidence; original evidence retained. |
| Rules/architecture | verified-current for scope | No new schema, provider, dependency, workflow, route or architecture change; no ADR needed. |
| Memory | out-of-scope | No memory writes. |
| Workspace | verified-current for reviewed files | Only reviewed code/tests/plan and then evidence/status; existing .tmp residue and databases preserved; no cleanup. |

The earlier tool disconnect left a partial patch; read-only diff was checked after reconnection before continuing. A guard initially landed in firstString rather than renderTemplate; it was moved before any tests or commit. No failed or partial state was reported as verified.

Code/plan diff check PASS; raw build logs retain tool-emitted trailing spaces. Existing auto-import/bundle/Browserslist/loader warnings and three Windows skips remain. Secret scan exit 1 means no match in its recorded scope. No new TODO/FIXME or conflicting live-scope claim introduced. PR8 stays draft/stacked; parent re-review pending, R2 overall incomplete. No CI runs is not CI PASS. CA, live, retained database migration, browser/S7, merge and deployment are NOT_RUN/out-of-scope. Review artifacts retained.
