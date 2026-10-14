# R2-7 P2 repair closeout — 2026-10-14

Code `79fc6c84b29497c869e029d27130ac02c8c04251`. This limited round fixes both parent findings; no new migration, source, Provider, credential, permission or production activation.

## Permission and immutable history

Manual persistence is now a pure product-scoped policy: exact TH-W01 CAP endpoint may use the already-accepted feed public-domain full scope; exact BMKG nowcast RSS may use existing excerpt scope. Bound is min(product,DB). Feed canonicalizer still determines identity. Same-host /story and unknown query variants are not licensed products: body rejected, empty-body metadata allowed. Unknown/manual catalog products never gain body rights from a wider source DB field. No new license is inferred. Checklist/form explain product limits. The same read policy clips previously stored manual out-of-product body to metadata without writing or deleting immutable history. Auto versions keep their existing acquisition contract and are not relabelled manual.

## Attribution

New bound SELECT getManualVersionAction uses source/item/version, action submit, latest matching row; independent of the20-row audit display. Detail selected/manualEntry and list current identity use that query.23manual submissions plus an automatic version show early manual label and actor preserved; automatic version stays null. GET under PRAGMA query_only and snapshots still passes. Audit display remains20, list50, versionsfirst20; no claim of expanded pagination. Selected actor/time displayed independently from recent audit rows.

## Evidence

Fresh `.tmp/manual-p2-final-build` install scripts enabled, build/typecheck/lint,129targeted,121files1149pass/3existing Windows skips,3isolated native/Runtime/Feed smokes rawexit0.50focused manual cases,3new regressions. Exact source diff0 and retained database/secret-file hash equality. Neither docs SHA nor dirty code stands in for tested code. Original f312a00 proof is historical and must not imply product-scoped licensing or unlimited identity lookup.

68loopback HTTP/API/assets checks at4488/feed PID65236: exact CAP/BMKG positives, same-host body negatives, request/restore/check-empty/security,22later versions then early-version read, unchanged protected counters, all7old previews retained. Clearly synthetic manual samples only, old3policy fixtures preserved. No URL site fetching/model/paid calls. Tests guard external fetch, but counters alone are not packet capture or blanket egress proof. No real-source entitlement/accuracy claim.

Browser visual/actual events/keyboard/widths/S7 NOT_RUN; official browser limitation unchanged, no workaround of previous rejectedCDP. Parent review pending; no next slice, aggregate R2/R5 PASS, merge/deploy/force-push.

## Real Neat Freak

Previously read installed v3.0.0 skill and verification reference applied. Real audit-inventory.sh rerun exit0, enumeration not security audit. Status/architecture/AGENTS aligned to current narrow contract; historical slice marked superseded for license/identity. No old migrations rewritten, no cleanup or memory writes. React hooks/queries remain unconditional; added selected actor text is escaped and provider-free. Source module policy is pure and uses existing static source definitions, not a network call.

Facts: code changed-and-verified (offline/API); runtime partial verified with GUI pending; docs changed-and-verified; rules verified-current with narrow permission guard; memory generated-read-only/out-of-scope; workspace preserved, cleanup needs later explicit confirmation. Existing warnings retained (duplicate imports/chunk/Browserslist/loader/Windows skip/CRLF). New evidence scan only, no historical key inspection. Clones/drivers/logs/DBs/old preview builds retained for review.
