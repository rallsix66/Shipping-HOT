# R2 bounded observation launcher — offline implementation, 2026-10-19

> Later actual CLI execute exposed a Windows environment P2 not covered by the original39 tests. The authorized offline repair and real zero-budget CLI positive are recorded in [environment repair](../r2-observation-env-repair-2026-10-19/report.md). Original source/gate/diff evidence below remains historical and is not overwritten.

Local candidate on `codex/shipping-hot-r2`, parent HEAD `40629587e22d8932df105962ec214530e4054414`, Windows workspace `D:\try one\Shipping HOT`. No commit/push/PR update or production activation was performed. Independent parent acceptance of this candidate is pending. Current qualification remains 25/39 public sources, 24/34 information fields, historical numeric diagnosis 3/5; R2 remains BLOCKED and R2-8 remains NOT_RUN.

R2-6 already received parent limited PASS at `aea56e72ec11fa76986deccc5c3a9797584ab157` for reuse/dedupe architecture over product `954c831f27eff4fd4382a0ea68be3894de053759`. This does not mean every row of the 52-row map is implemented. No new cursor/validator gate is introduced.

## Implemented boundary

`pnpm observe:intel --help` describes the explicit launcher. Missing `--execute`, run ID, sources, duration or physical request cap fails before creating a run. Only existing TH-W01 TMD and ID-W01 BMKG are selectable. The exact roots remain:

- TH-W01: `https://www.tmd.go.th/en/api/xml/CAP`; existing full permission.
- ID-W01: `https://www.bmkg.go.id/alerts/nowcast/en/rss.xml`; existing excerpt-only permission, 280-character stored excerpts.

The CLI creates a new direct child `.tmp/r2-intel-observe-<id>`, launches a hidden Node child in that cwd and builds its environment from only system Path/SystemRoot/ComSpec/Temp equivalents plus fixed real/intel flags and UTC. Credentials, proxy/Node options, extra CA and other Shipping configuration are not inherited. The worker independently validates the environment, manifest/root/cwd and exact child entry. It never copies SecretStore or retained SQLite. Existing run directories/databases are refused, never reset or resumed.

The worker explicitly registers only the existing `intel-collect` job on the existing singleton `BackgroundRuntime`. Existing bootstrap, DB ownership, collector, parser, per-source backoff, adaptive formula, repository dedupe/versioning and license-scoped blocks remain the implementation. A one-shot deadline is a run stop, not another collection scheduler. The existing job gains only an optional stop signal checked before work and between sources. Without that option existing callers retain their behavior.

The existing15-minute job tick and per-source adaptive15–60-minute interval are fixed. No `runNow` command/frequency override exists in the CLI. A fresh Runtime's first scheduled tick is15 minutes after startup. Duration must be1..86,400,000ms; total physical transport cap is0..200. Cap zero ends before DNS/source collection.

`createObservationNetwork` wraps the required lookup/transport dependencies, without replacing `secureFetchArticle` or `defaultTransport`. Every transport dispatch reserves one shared slot synchronously before any await and writes its reservation before delegation. Each redirect hop spends a separate slot; dispatched failures also spend a slot. `provider_usage.request_count` still counts job capability invocations and is not used as the physical HTTP budget. A synchronous pre-send failure may conservatively consume a slot; the cap can never be exceeded or reset by restart.

Only exact selected root URLs and separately explicit same-host HTTPS redirect edges are allowed. Defaults approve no redirect. Unapproved Location, a private/mixed DNS result, host/URL scope violation, ledger failure, detected clock reversal or deadline blocks further dispatch; unsafe/deadline stops abort in-flight HTTP. Redirect targets are refused before their DNS/HTTP. Existing TLS/pinned-DNS/CA/content-type/byte/redirect-limit protections are unchanged. Body/detail/page URLs have no separate path around the wrapper.

On the last available slot, new work stops while that reserved response may finish. The deadline can still abort it during drain. Stop reasons retain later causes even when budget exhaustion occurred first. Operator interrupt or parent IPC disconnection also stops collection. Shutdown follows existing stop → drain → executor.end → owned-lock release; no age/PID deletion, forced close or successful receipt on incomplete shutdown.

Per-run artifacts are `launch.json`, `manifest.json`, `events.jsonl`, isolated `.data/shipping-hot-v3.sqlite3`, and `result.json` after successful drain/read-only reopen. The ledger stores DNS/status/byte/hash/redirect metadata and normalized source run/state counters, not response bodies. The isolated DB stores only existing license-permitted normalized blocks. Final audit rejects out-of-scope source runs, non-intel Provider usage and nonzero paid receipt/attempt/translation-cache state. Existing catalog metadata rows remain initialized and disabled; their presence is not source collection.

The shared `tsx-alias-loader.mjs` now checks that a candidate is a file, so `intel/sources.ts` is selected when a same-named directory exists. Absolute loader arguments use file URLs on Windows. Both defects were found by actual Node subprocess checks and repaired, with failure logs retained.

## Verification

Final gate and source fingerprints: [summary](summary.json). The gate clone is `.tmp/intel-observation-clean-20261019`, created from the exact HEAD without existing node_modules or `.data`, then overlaid only with the reviewed11 code/package files. Frozen installation executed normal lifecycle/native scripts; no copied native modules or ignore-scripts.

New tests cover zero/exact/concurrent caps; redirect hop accounting/refusal; remaining timeout, delayed DNS, deadline after final reservation, reversed clock, unsafe address and disk-ledger failure; actual CLI help/no-execute; child environment rejection before DB/bootstrap; one Runtime/job; real SQLite adaptive due times; existing failure backoff and success-empty; duplicate versions; TMD/BMKG license scope; final-response drain/end/lease release; deadline abort; read-only persistence in a fresh OS process; and refusal of old/retained/non-real directories. Network tripwires in the integration tests reject real DNS/HTTP/HTTPS calls.

Initial fixture/type/style/CLI failures, sandbox install EACCES and the first full-suite Windows loader failure remain in ignored `.tmp/intel-observation-20261019` logs. They are not rewritten as successful runs. The successful frozen install after sandbox escalation and final gate are listed separately.

## Remaining scope and operational limits

No source DNS/HTTP collection, real capture, model/paid call, browser control, GUI/S7,24h run, deployment, service restart, network configuration or production enablement was performed. Development dependency downloads for the frozen install are separate from business collection. Zero business calls is not a whole-machine packet-capture assertion.

Real observation still requires a separate approval specifying exact selected URLs/redirects, UTC start/end window, fixed frequency, total physical budget/stop rules and isolated run ID/path. A two-source observation cannot qualify all39 public sources. A normal deadline exit is not24h acceptance: manifest/result explicitly withhold continuous24h acceptance, and sleep/network/clock gaps need independent review. Interrupted windows cannot be joined or resumed. A non-cancellable underlying DNS lookup or incomplete drain keeps shutdown pending/ownership retained; no deadline permits deleting that lock.

The active manual plugin/service/database remain separate from this candidate. Existing dirty `.gitignore` and `docs/status.md` were preserved. No generated run DB, Secret, debug log or raw full text is part of the reviewable patch. [Real Neat Freak closeout](closeout.md).
