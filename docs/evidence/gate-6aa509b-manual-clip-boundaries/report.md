# P2 clip text boundaries — limited repair, 2026-10-16

Code `6aa509b8daa2f931827cef2b6d3d7e57e4d56a04`, based on `258bfb8eb20ca5b7a37700f703c95b8ed7992997`, on the existing `codex/shipping-hot-r2` branch. Execution remained local on Windows under `D:\try one\Shipping HOT`. This repair changes only `plainSelection`, its exact-output regression tests and the extension text-format description. No backend, schema, dependency, permission, bridge, provider, source or workflow change.

## Finding and repair

Parent review found that joining each HTML node's textContent with an empty string erased structural boundaries. The baseline actual function produces `关闭10:00恢复18:00` for adjacent paragraphs and also concatenates line breaks, list items and table cells. `baseline-negative-control.json` records four authored synthetic cases against the actual baseline function isolated in a VM with inert DOM; all four fail the required exact output. The accompanying script preserves that diagnostic. It is not a browser run.

The repair traverses the existing inert template after the same dangerous-node removal. Paragraph/block boundaries emit blank lines; br and list items emit newlines; table cells emit tabs and table rows emit newlines. Inline text remains plain text. Both selection and article share this function. No HTML is rendered/adopted and no remote resource fallback is added. Existing stored versions are not rewritten or re-fetched.

The DOM test file now has17 tests: the existing5, four exact separator/removal cases and eight real-pipeline cases (four structures × selection/article). Article cases use the actual synchronous Defuddle path rather than a parser mock. Each of the eight asserts the exact preview.body, exact clipSavePayload body and exact body read from the real manualSubmit/IntelRepository SQLite material reader. The tests runtime-load real Node server modules while keeping their production TS project separate from the browser-DOM TS project. Fetch remains a rejecting test stub.

## Clean-SHA verification

Fresh local clone `.tmp/clipper-final-6aa509b`, with no pre-existing node_modules; Node24.15.0 / ABI137 / pnpm10.30.3. Normal official-registry frozen install including scripts, production build, node/app/extension typecheck, lint, extension build,10 targeted files/140 tests,137 full files/1404 passed +3 existing Windows skips, and three original isolated smokes all returned rawexit0. Raw command JSON/stdout/stderr and package file hashes are retained. No checks were weakened.

Four retained DB/Secret hashes are unchanged before/after the clean-clone gate. The driver issued zero business-source or paid-call commands; scoped synthetic tests reject fetch and use isolated SQLite. This is action/test evidence, not packet-level egress monitoring of the entire machine. Normal dependency installation is a separate allowed network action.

The fresh build leaves only the known generated routeTree.gen.ts EOL/stat marker; ordinary and whitespace-insensitive diffs are empty. It is retained. Root product worktree was clean after the repair commit. Existing Vite/Browserslist/unimport warnings and3 Windows skips remain disclosed.

## Limits and deliverable

P2 repair/offline verification is PASS within this limited scope; independent parent acceptance remains pending. Chrome installation, permission grants, real-page reading, actual Manifest/message delivery, visual/keyboard/widths and current GUI/S7 remain NOT_RUN. No custom CDP,24h, real source collection, paid call, production switch, merge, deployment, force-push or cleanup.

Latest uninstalled package: `.tmp/clipper-final-6aa509b/.tmp/clipper-package`; zip `.tmp/Shipping-HOT-Clipper-6aa509b.zip`. The older c83e118 package/evidence is retained as pre-repair history. R2's unrelated BLOCKED state and25/39,24/34,historical3/5 are unchanged. The public ID and exact loopback receiver remain the already reviewed values.

Zip SHA256: `2DA50E15BFCFF31A852E49FC7A81C6C7F58A323B3658CD5F8B260EF34F1759CA`.
