# Runtime incomplete shutdown P2 repair - 2026-10-13

Tested code SHA `cb86aabaf715f82eed6d53aa5e481404b37635e3`, clean before gates. Scope: the parent-reported stopped-runtime bootstrap success after an end/release cleanup failure. No new GET or production lock implementation.

- shutdownIncomplete is set before cleanup and cleared only after successful completion. Bootstrap checks it before returning an existing runtime. A failed cleanup therefore rejects bootstrap instead of returning a stopped instance.
- Successful end steps are removed from the pending queue. Ownership remains until release succeeds; cleanup retries resume unfinished steps. Concurrent shutdown still shares the in-flight promise. A completed cleanup permits a fresh runtime/executor.
- Two actual-factory/isolated DB regressions inject first end failure and first release failure. Each checks shutdown rejection, stopped status, retained ownership, rejected bootstrap without reacquisition, retry cleanup, exact end/release call counts (completed steps not repeated), repeated empty cleanup and successful fresh startup/run.
- Local gate PASS: registry/bootstrap/Runtime 24/24 (intel-bootstrap 9/9), full suite 108 files / 1008 passed / 3 skipped; install/build/typecheck/lint, all other targeted sets and P0/P2C/P3 isolated smoke exit 0. Raw UTF-8 command/full SHA/stdout/stderr/raw exit preserved here. Previous 22/1006 evidence remains unchanged as pre-repair history.

Applied actual installed neat-freak v3.0.0 and its verification reference already read in this conversation; ran the bundled Git Bash inventory, exit 0. Inventory is not a security audit.

| Surface | State | Action/evidence |
| --- | --- | --- |
| Code | verified-current | Failure-state guard and progress-aware cleanup; two regressions/full gate. |
| Runtime | pending live | Isolated native DB/offline lookup+transport/fixed clock only; no production lease or source enabled. |
| Docs | changed-and-verified | Existing Runtime contract/status record P2 and distinguish old/new SHA evidence. |
| Rules/architecture | verified-current for scope | Default disabled/empty sources/no fetch, external ownership prerequisite and recovery order unchanged. No migration/provider/GET/UI/ADR/workflow change. |
| Memory | out-of-scope | No memory writes. |
| Workspace | verified-current for reviewed paths | Only reviewed bootstrap/test/contract and then docs/evidence; no secret, retained DB or production config staged. Residue and prior logs retained; no cleanup. |

Code/docs diff check excluding raw logs PASS; raw build logs retain tool trailing spaces. Existing auto-import/bundle/Browserslist/loader warnings and three Windows symlink skips remain. Secret scan exit 1 = no match in recorded scope. Parent re-review pending; R2 overall incomplete. No live/paid/LLM/production ownership/GET/merge/deploy operation. No branch CI run is not CI PASS.
