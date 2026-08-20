# ADR-005: Shipping HOT V3 Real-Data Boundaries

- Date: 2026-08-20
- Status: Proposed
- Decision owners: User (architecture approval pending)
- Supersedes: none; extends ADR-004 only after explicit V3 approval

## Context

Shipping HOT V3 is a proposal for moving from the V2 mixed/mock runtime to a local-first, real-data operational runtime. The review found that adding search, translation and more Providers on top of the current request-triggered flow would leave several unsafe ambiguities: SQLite failure can expose a Mock snapshot, `vessels` emptiness is used as a seed signal, user watch state shares rows with Provider state, VesselAPI could be mistaken for live AIS, Port Search could become dependent on a paid entitlement, and translation would have no durable cache, secret or usage contract. The implementation order therefore separates **P1A Real Port Directory Foundation** from **P1B Mock Isolation + AIS Tracking Runtime**; P2 depends on both.

This ADR is intentionally **Proposed**. It does not authorize implementation, account creation, paid subscriptions, key entry or schema migration. Implementation starts only after the user explicitly confirms `架构确认，开始执行 Phase 1`.

## Proposed decision

### 1. Real-only operational boundary

- `SHIPPING_DATA_MODE=real` and production reject Mock Providers, Mock seed, fixture coordinates and `mock-schedule`.
- SQLite is the only persistent truth. Startup records `app_metadata.schema_version` and `bootstrap_completed_at`; empty AIS observations do not mean that bootstrap has not completed.
- SQLite states are `healthy`, `read_only_degraded` and `unavailable`. An unavailable database does not create a mutable memory store or silently expose the complete Mock snapshot. Mutations return `503 persistence_unavailable`.
- Provider failures return same-Provider real last-known data as stale/degraded, otherwise empty/unavailable/unknown.

### 2. Provider boundaries and ownership

- VesselAPI is a low-frequency Vessel Discovery/static metadata candidate. Its search result does not imply live position, Port entitlement, ETA or port-event entitlement. Every optional capability requires an account-level contract test.
- AISStream is the watched-vessel tracking source. A long-lived server-side singleton `AisTrackingService` subscribes only to watched MMSI values and consumes `PositionReport` plus available `ShipStaticData`/`StaticDataReport`; HTTP GET does not open a short-lived WebSocket. V3 first release caps one session at 50 MMSI (`FiltersShipMMSI` current limit); no sharding is designed before that limit is reached.
- Port Search defaults to a local UNECE UN/LOCODE directory, normalized coordinates and a curated Chinese-alias table. VesselAPI Port API is optional enrichment only.
- DCSA Commercial Schedules is an internal normalization contract, not a data Provider. Carrier adapters require separate official access, terms and price confirmation. Without one, Commercial Schedule is empty/unavailable and never Mock.
- Fields are provider-owned, user-owned, directory-owned or translation-owned. Provider upserts can update only provider-owned columns; user watch, aliases, settings and overrides cannot be replaced by Provider rows.

P1A must establish the real Port Directory (UN/LOCODE, verified identities, coordinates and aliases) before P1B removes Real Mode imports of `shared/shipping-fixtures.ts`. P1B then removes Mock seed/schedule/fixture dependencies and installs the long-lived AIS runtime. P2 Search & Watch cannot start until both stages pass their acceptance tests.

### 3. Translation and secrets

- Define a switchable `TranslationProvider` interface. Candidate adapters include DeepSeek, Qwen, Gemini, OpenAI, Claude, Google Cloud Translation, DeepL, Azure Translator and Custom OpenAI-compatible; no single Provider is an architectural default.
- Store original text first. Translation is asynchronous enrichment and never blocks ingestion. Identifiers such as registered vessel name, IMO, MMSI, Callsign, Voyage number, SCAC and UN/LOCODE are never translated.
- `translation_cache` is the only translation source of truth. Business tables keep only original facts; they do not duplicate `title_zh`/`summary_zh`. The UI selects the preferred provider/model when available, otherwise shows the most recent successful Chinese cache entry and queues the preferred version. Old provider/model versions remain auditable.
- `ProviderConfig` (provider/model/base URL/enabled/budget) is separate from `ProviderSecret` (API key). P0 only establishes the contracts, registry refresh and redacted APIs; actual AI adapters belong to P6 or a separately approved Provider phase.
- `provider_usage` records local request outcomes, cache hits, characters/tokens, estimated cost and last call. A balance is shown as “本地统计/估算” unless the Provider returns an official remaining value.
- Settings exposes an AI Translation Center with Provider/model, endpoint for Custom, enable state, locale, budget and sanitized health. When no official balance API is available, usage is labeled “本地统计/估算”, not account balance.
- Define a server-only `SecretStore` interface (`get/set/delete/has/source`). Local mode uses `FileSecretStore` at `.data/provider-secrets.json`; environment variables or a platform Secret Manager take precedence and are immutable from the UI. A successful Settings mutation refreshes the Provider Registry immediately, so the next job/request uses the new secret without a restart. Secrets never enter LocalStorage, frontend bundles, Git, docs, fixtures, ordinary SQLite columns, `provider_runtime`, logs or error messages.

### 4. Freshness and lifecycle

Feed uses three gates: Ingestion Gate, Current Feed Query Gate and HOT/Event Freshness Gate. Ordinary news defaults to 7 days, major operational news to at most 14 days, and official notices/alerts follow explicit effective/expiry rules. Unknown or malformed publication times are quarantined/history-only.

Calendar follows `Server Start → SQLite → UI → background check → sync`; current year and next year are independently tracked by country/year coverage and last success. The default TTL is about 7 days (roughly 40–50 calls/month for five countries × two years), while a year change forces a check and manual refresh remains available. Calendar freshness is not inferred from Feed age windows.

## Consequences

- V3 can provide a real watchlist and Current Voyage even when Commercial Schedule or a per-port intelligence capability is unavailable.
- The plan can be run at zero external Provider cost, with optional low-cost Discovery/static enrichment and separately budgeted translation.
- More schema and runtime work is required in P0: metadata/bootstrap, ownership isolation, runtime/usage, translation skeleton, `ProviderConfig`/`ProviderSecret` and `SecretStore` contracts must exist before P2/P6; P0 must not implement all AI adapters.
- Provider prices, entitlement, public signup and regional availability remain time-sensitive and must be rechecked before implementation.

## Verification required after approval

- Native SQLite restart smoke under the selected Node LTS; no reseed when `vessels` is empty; mutation success only after commit.
- Production bundle scan proves no fixture import, Mock seed or `mock-schedule` in real mode.
- P1A real directory tests cover UN/LOCODE, coordinates and `Shekou`/`CNSHK`/`蛇口`; P1B proves Real Mode has no fixture/Mock seed and HTTP GET creates no AIS socket.
- AIS long-lived session and watchlist resubscription tests cover Position + Static/Voyage facts, finite reconnect and the 50-MMSI ceiling.
- UN/LOCODE + `Shekou`/`CNSHK`/`蛇口` identity tests without VesselAPI.
- Translation identifier denylist, single-source cache selection, cache-hit/no-repeat billing, budget stop, SecretStore precedence/immediate reload, secret redaction and usage-label tests.
- Feed 7/14-day/future/unknown/expiry gates and Calendar restart/background-sync/7-day-TTL tests.
