# R2 intel default-off Runtime registration - 2026-10-13

Authorized slice: connect collection/due/backoff to the existing BackgroundRuntime registry/bootstrap under the 9/29 plan. Application registration and offline verification only; no schema, GET/UI, provider activation, real egress or new scheduler.

## Connected paths

- Existing Nitro plugin invokes bootstrapBackgroundRuntime; its default registry now constructs exactly one intel-collect job. The default is disabled with empty sources and no fetcher, even though historical direct-job seed fixtures include TMD/BMKG. No intel enable environment variable or runtime source-config write is introduced. Existing Feed/weather/etc factory paths and IDs are unchanged.
- Explicit test/integration injection is registry.intel: enabled, seeds, fetch and optional interval. Enabled registration requires nonempty explicit seeds and fetch; no implicit live transport/default source selection. The job's existing source due-time/health/backoff and unique source-run constraint remain unchanged.
- Enabled intel bootstrap requires acquireIntelOwnership. This is a trusted application dependency, not a boolean assertion or UI option: the caller must actually acquire DB-specific exclusive ownership across all relevant processes/executors and hold it for the full runtime lifetime. It must reject if another owner is active and provide asynchronous release. This slice provides the seam and tests a rejecting lease provider; it does not supply a production OS/process-lock implementation or prove cross-process exclusivity by itself.
- recoverInterruptedIntel is absent/false by default. Only a bootstrap that acquired that ownership may call recoverIntelRunsAtExclusiveStartup, before runtime starts. Repeated/concurrent bootstrap returns the existing runtime/promise and never repeats recovery. There is no age/heartbeat inference or automatic stale-lock cleanup. Safe recovery of already-ended executors stays in the job.
- Runtime shutdown stops scheduling, drains tracked execution promises, calls the intel job end method, then releases ownership. A new bootstrap waits for shutdown. Busy/manual executors still refuse end; failed end/release does not silently surrender ownership. Startup failure cleans up its jobs/lease; retained unreleased ownership blocks replacement startup.

## Not connected

Shutdown P2 repair: end/release failure retains shutdownIncomplete; bootstrap rejects with runtime_shutdown_incomplete instead of returning a stopped instance. Completed end steps are removed from the pending queue, and ownership is cleared only after successful release. Explicit shutdown retry resumes unfinished steps; successful steps are not repeated before a fresh startup.

Real source seed selection/fetch, production exclusive-ownership provider, automatic crash recovery, GET/UI, registry enable settings, 304/ETag, P1 live fixtures, manual input, paid/LLM/R3 and 24h live acceptance. Production plugin uses only default-off registration. Do not enable a second TMD/BMKG weather collection chain under this registration change.

## Offline verification

Actual registry/bootstrap combination with isolated native DB, fixed clock/fake timers and injected offline lookup/transport: default disabled/no sources, unique jobs and no Feed/weather duplication; due scheduling/per-source backoff/independent health; same-job reentry; concurrent bootstrap; shutdown/drain/executor end/ownership sequencing; rejected acquisition while another executor is active; startup-failure cleanup; missing lease failure before recovery; actual file-backed DB reopen with synthetic crash residue and explicit ownership before recovery. No retained DB or real network. Code-SHA full gate and Neat Freak evidence are recorded in docs/status.md; parent review pending.
