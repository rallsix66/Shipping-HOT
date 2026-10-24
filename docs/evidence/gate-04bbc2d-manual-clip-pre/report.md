# PRE whitespace repair — offline evidence, 2026-10-16

Final product code `04bbc2d6c72f452fe9cf5a963659670d9b3f9f77`, baseline `b24c4bbc5b4ba2bc510a2bdd94dfb006048633d7` (product `f95f73b4f6b3e6c150fc442f1b10f5fb308e6b71`). Windows local repo `D:\try one\Shipping HOT`, branch `codex/shipping-hot-r2`. Parent confirmed the original paragraph/br/list/table repair, then found its PRE whitespace regression. This follow-up changes only the same converter, exact tests and extension README; no dependency, upstream parser, backend, schema, permissions, bridge, provider or workflow changes.

## Repair and exact regression contract

`plainSelection` keeps PRE subtree text in separate verbatim parts, including text inside inline elements. Ordinary text is still normalized. Structural boundary trimming and final newline cleanup operate only on ordinary parts, so they cannot collapse PRE double spaces, tabs, internal blank lines or edge indentation. The existing inert template and dangerous-node removal remain before either text walk. Output remains plain text; no HTML is adopted or fetched. Existing saved versions are untouched.

Five new fixtures cover double spaces with multiple lines, tabs, edge spaces with three internal newlines, inline strong/code/span with dangerous nodes, and PRE surrounded by ordinary paragraphs/br. Five exact converter assertions and ten exact preview → save payload → actual manualSubmit/IntelRepository → SQLite material-read chains were added. Final DOM file:36 tests, including20 full-chain cases. Original paragraph/br/list/table and partial-table selection assertions remain passing.

Selection preserves the parsed PRE text verbatim. **Article mode still runs the unchanged synchronous Defuddle0.19.2 first**, whose existing code-block transform expands tabs and trims/dedents/collapses some blank lines. The five article regressions pin that output separately and prove the converter and save/read chain do not further compress it. For example, selection `港口A\t10:00\n港口B\t\t18:00` stays exact, while the existing article stage emits four/eight spaces in place of those tabs. This repair does not claim raw-page PRE fidelity before Defuddle; the README directs users needing original selection whitespace to selection mode. No parser mock or expectation of raw article whitespace is used.

`baseline-negative-control.json` executes the actual f95f73b converter, with only TypeScript annotations transpiled away, in an isolated VM against five synthetic inert-DOM fixtures. All5 fail exact expected text as intended. The original new-fixture development run also failed before the repair; its local log is retained in ignored.tmp. No real webpage or third-party full-text sample was used. Test fetch is a rejecting stub; server functions and SQLite storage are real.

## Clean-SHA gate

Fresh local clone `.tmp/clipper-pre-04bbc2d`, no reused node_modules; Node24.15.0 / ABI137 / pnpm10.30.3. Frozen official-registry install including scripts, production build, typecheck, lint, extension build,10 files/159 targeted tests,137 files/1423 full passed +3 existing Windows skips, and3 original isolated smokes all rawexit0. Command JSON/stdout/stderr, executed driver and package file hashes are retained here. [Summary](summary.json), [negative control](baseline-negative-control.json), [closeout](closeout.md).

Four retained database/Secret file hashes are unchanged. Zero business-source fetch or paid-call commands were issued; the permitted dependency install is separate network work. These action counts and rejecting-fetch synthetic tests are not whole-machine packet capture. No checks were disabled. Existing Vite chunk/Browserslist/unimport warnings and3 Windows skips remain. The isolated build leaves the known generated routeTree.gen.ts EOL/stat marker, with empty ordinary and ignore-space-at-eol semantic diffs; it is preserved.

## Delivery and remaining acceptance

Latest uninstalled package `.tmp/clipper-pre-04bbc2d/.tmp/clipper-package`; zip `.tmp/Shipping-HOT-Clipper-04bbc2d.zip`. ZIP SHA256 `93608EC0BBF195EB0BBD6A3317A9C77C9BEC4618CA72757875D1347967A78234`. Previous c83e118/6aa509b/f95f73b packages and gates remain historical, not the latest delivery.

Repair/offline verification PASS within this scope; parent independent acceptance pending. Chrome installation/permission grants, real pages, actual extension delivery, visual/keyboard/width and GUI/S7 remain NOT_RUN. No custom CDP, production task/config,24h, real-source collection, paid call, merge, deploy, force-push or cleanup. R2 remains BLOCKED;25/39,24/34 and separate historical3/5 are unchanged. Manual clipping remains unverified manual material, never official-event or automatic-source acceptance evidence.
