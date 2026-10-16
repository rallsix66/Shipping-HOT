# P2 text separator repair — final offline evidence, 2026-10-16

Final code `f95f73b4f6b3e6c150fc442f1b10f5fb308e6b71`, including the initial converter repair `6aa509b8daa2f931827cef2b6d3d7e57e4d56a04` and the partial-cell selection follow-up. Original baseline `258bfb8eb20ca5b7a37700f703c95b8ed7992997`. Windows local repo `D:\try one\Shipping HOT`, existing branch `codex/shipping-hot-r2`. Only the converter, its tests and formatting description changed; backend/schema/dependencies/permissions/bridge/providers/workflow are unchanged.

Parent's P2: adjacent p/br/li/td/tr content was joined without separators. The same inert template and dangerous-node removal now feed a structural text walk: block/paragraph blank lines, br/list-item newlines, table-cell tabs and row newlines. Direct td/th and tr fragments from a partial selection also retain separators. Output is still plain text and never adopted as active HTML. No new remote-resource path. Existing versions are preserved rather than rewritten/re-fetched.

`baseline-negative-control.json` runs the actual original plainSelection in an isolated VM with authored inert-DOM fixtures: paragraphs, br, list, full table, selected cells and selected rows. All6 reproduce the missing separators. Script and exact actual/expected strings are retained, not a browser claim.

The test file now has21 DOM cases:5 original +6 exact separator/dangerous-removal cases +10 actual preview→save-payload→SQLite material-read cases. The latter cover four full structures in both selection and actual synchronous Defuddle article mode, plus direct cell/row fragments in selection mode. Every stage is asserted against a fixed exact output; server functions are real runtime imports, not mocks. Global fetch is a rejecting stub. This proves the synthetic text chain, not real Chrome delivery.

## Final clean-SHA gate

New local clone `.tmp/clipper-final-f95f73b`, no old node_modules; Node24.15.0 / ABI137 / pnpm10.30.3. Normal official-registry frozen install including scripts, production build, typecheck, lint, extension build,10 files/144 targeted tests,137 files/1408 full passed +3 existing Windows skips, and3 original isolated smokes all rawexit0. Raw command JSON/logs and package file hashes are retained. The same gate at interim6aa509b is preserved separately; this final gate supersedes it for delivery.

Four retained DB/Secret hashes are unchanged. Zero business-source/paid-call commands were issued; dependency install is separate permitted network work. Synthetic rejecting-fetch and local SQLite evidence is not packet-level monitoring of the whole machine. No thresholds/tests were weakened. The build leaves the known generated routeTree.gen.ts EOL/stat marker with an empty semantic git diff, preserved in the isolated clone.

## Delivery and limits

Latest uninstalled package `.tmp/clipper-final-f95f73b/.tmp/clipper-package`; zip `.tmp/Shipping-HOT-Clipper-f95f73b.zip`. Prior c83e118/6aa509b packages and raw gates remain historical, not the latest delivery. Exact file hashes: package-files.json.

Zip SHA256: `A552B7B2B49FFADF25BC1161467001880319A0BF66FC93F492C5E2EB2B94BE79`.

Repair/offline verification PASS within this P2 scope; parent independent acceptance pending. Chrome install, permissions, real pages, actual Manifest/message delivery, visual/keyboard/width and GUI/S7 remain NOT_RUN. No custom CDP,24h, real source collection, paid call, production setting, merge/deploy/force-push or cleanup. R2 remains BLOCKED with25/39,24/34 and separate historical3/5 unchanged.
