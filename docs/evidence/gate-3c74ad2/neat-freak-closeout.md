# R2 default-off intel registry/bootstrap closeout - 2026-10-13

Code SHA `3c74ad20004f8bde9797512cea699b9a70b5ce31`, clean before gates. The later evidence/status commit is separate from the tested code.

## Connected and deliberately unconnected paths

- Existing Nitro plugin -> bootstrapBackgroundRuntime -> getDefaultRuntimeJobs -> one intel-collect job on the existing BackgroundRuntime. Default disabled, empty registry seed list, no fetcher; no enable environment variable. Existing Feed/weather jobs stay on their original factory paths, with no duplicate IDs or automatic second TMD/BMKG collection chain.
- Explicit injection of enabled intel requires seeds/fetch; bootstrap requires acquireIntelOwnership. That trusted adapter must really obtain exclusive ownership for the exact database across relevant processes/executors before resolving and retain it until release. This slice tests a rejecting lease adapter and the lifecycle contract; no production OS/process-lock adapter or cross-process guarantee is implemented by the interface alone.
- Interrupted-run recovery is opt-in and occurs only after ownership acquisition, before runtime execution. Repeated/concurrent bootstrap returns the existing runtime/promise; it does not recover again. No age-based ownership inference or stale-lock removal. Existing ended-executor recovery remains safe while other executors are active.
- Shutdown stops timers, drains tracked executions, ends the intel executor, then releases ownership. Replacement bootstrap waits for shutdown; active/manual executors still refuse premature end. Unreleased ownership blocks replacement startup. Startup failure cleanup/retry tested.
- Production ownership adapter, real intel sources/fetch, enable settings, GET/UI, 304/ETag, P1 real fixtures, manual input and 24h live acceptance are not connected. No new scheduler, schema or paid/LLM/R3 path.

## Verification

- Seven new actual-factory/bootstrap integration cases: default off/no seeded rows/no duplicated Feed/weather jobs; source due schedule/backoff/independent health; same-job reentry and concurrent bootstrap; drain/end/release/replacement order; rejected ownership with another active executor; startup failure cleanup/retry; missing lease result before recovery; file-backed isolated reopen with synthetic crash rows and explicit ownership before recovery (some assertions share cases).
- Fixed TEST_NOW and controlled clock/fake timers; injected public lookup/offline XML transport. Other existing jobs are registered but never executed during the short timer advances; only intel is explicitly run. File-backed DB directories are newly created under .tmp, retained for review. No retained database or business-provider socket used. Reopen verifies persisted rows, not an actual process-kill or live-source test.
- Local gate PASS: registry/bootstrap/BackgroundRuntime 22/22, intel 137/137, JSON 49/49, web-list 42/42, Feed/security/etc 77/77, paid/translation 114/114, full suite 108 files / 1006 passed / 3 skipped. Install/build/typecheck/lint and P0/P2C/P3 isolated smoke exit 0. Original UTF-8 command/full SHA/stdout/stderr/raw exit logs in this directory, Node 24.15.0.

## Actual Neat Freak fact matrix

Applied the installed neat-freak v3.0.0 skill/verification reference already read in this conversation. Actual bundled Git Bash inventory exit 0; inventory is not a security audit.

| Surface | State | Action/evidence |
| --- | --- | --- |
| Code | verified-current | Reviewed registry/default empty sources, bootstrap ownership/recovery, shutdown drain and executor end; full gate. |
| Runtime | pending live | Offline isolated verification only; plugin defaults to disabled intel. Production ownership provider is not wired. |
| Docs | changed-and-verified | Architecture, status and Runtime contract identify connected/unconnected paths and external ownership prerequisite. CA parent closure recorded without claiming live TLS/independent rerun. Earlier slice plans/evidence remain historical. |
| Rules/ADR | verified-current for scope | Existing BackgroundRuntime/SQLite boundaries retained; no schema/provider/framework/GET/UI change or new ADR. Draft stacked PR8 and single main-only workflow retained. |
| Memory | out-of-scope | No memory writes. |
| Workspace | verified-current for reviewed paths | Only reviewed source/tests/docs/then evidence staged; no secret/retained DB/real-source configuration. .tmp and earlier diagnostic artifacts preserved; no cleanup. |

Code/docs diff check excluding raw logs PASS. Raw build logs retain tool-emitted trailing spaces. Existing auto-import/bundle/Browserslist/loader warnings and three Windows symlink skips remain. Secret scan exit 1 is no match in recorded scope; counters/inventory alone do not prove offline operation. No new TODO/FIXME or claim that live ownership has been supplied. Parent review NOT_RUN/pending; R2 overall incomplete. Browser/S7 NOT_RUN (no route/UI/shell change); live/paid/registry activation/R3/merge/deploy out of scope. No branch CI run is not CI PASS.
