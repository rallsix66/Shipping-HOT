# ADR-005: Shipping HOT V3 Real-Data Boundaries

- Date: 2026-08-20
- Status: Proposed
- Decision owners: User (architecture approval pending)
- Supersedes: none; extends ADR-004 only after explicit V3 approval

## Context

Shipping HOT V3 is a proposal for moving from the V2 mixed/mock runtime to a local-first, real-data operational runtime. The review found that adding search, translation and more Providers on top of the current request-triggered flow would leave several unsafe ambiguities: SQLite failure can expose a Mock snapshot, `vessels` emptiness is used as a seed signal, user watch state shares rows with Provider state, VesselAPI could be mistaken for live AIS, Port Search could become dependent on a paid entitlement, and translation would have no durable cache, secret or usage contract.

This ADR is intentionally **Proposed**. It does not authorize implementation, account creation, paid subscriptions, key entry or schema migration. Implementation starts only after the user explicitly confirms `架构确认，开始执行 Phase 1`.

## Proposed decision

### 1. Real-only operational boundary

- `SHIPPING_DATA_MODE=real` and production reject Mock Providers, Mock seed, fixture coordinates and `mock-schedule`.
- SQLite is the only persistent truth. Startup records `app_metadata.schema_version` and `bootstrap_completed_at`; empty AIS observations do not mean that bootstrap has not completed.
- SQLite states are `healthy`, `read_only_degraded` and `unavailable`. An unavailable database does not create a mutable memory store or silently expose the complete Mock snapshot. Mutations return `503 persistence_unavailable`.
- Provider failures return same-Provider real last-known data as stale/degraded, otherwise empty/unavailable/unknown.

### 2. Provider boundaries and ownership

- VesselAPI is a low-frequency Vessel Discovery/static metadata candidate. Its search result does not imply live position, Port entitlement, ETA or port-event entitlement. Every optional capability requires an account-level contract test.
- AISStream is the watched-vessel tracking source. A long-lived server-side `AisTrackingService` subscribes only to watched MMSI values and updates subscriptions when the user watchlist changes; HTTP GET does not open a short-lived WebSocket.
- Port Search defaults to a local UNECE UN/LOCODE directory, normalized coordinates and a curated Chinese-alias table. VesselAPI Port API is optional enrichment only.
- DCSA Commercial Schedules is an internal normalization contract, not a data Provider. Carrier adapters require separate official access, terms and price confirmation. Without one, Commercial Schedule is empty/unavailable and never Mock.
- Fields are provider-owned, user-owned, directory-owned or translation-owned. Provider upserts can update only provider-owned columns; user watch, aliases, settings and overrides cannot be replaced by Provider rows.

### 3. Translation and secrets

- Define a switchable `TranslationProvider` interface. Candidate adapters include DeepSeek, Qwen, Gemini, OpenAI, Claude, Google Cloud Translation, DeepL, Azure Translator and Custom OpenAI-compatible; no single Provider is an architectural default.
- Store original text first. Translation is asynchronous enrichment and never blocks ingestion. Identifiers such as registered vessel name, IMO, MMSI, Callsign, Voyage number, SCAC and UN/LOCODE are never translated.
- `translation_cache` uses the approved entity/field/source-hash/provider/model/language key and stores the fields listed in the V3 plan. `provider_usage` records local request outcomes, cache hits, characters/tokens, estimated cost and last call.
- Settings exposes an AI Translation Center with Provider/model, endpoint for Custom, enable state, locale, budget and sanitized health. When no official balance API is available, usage is labeled “本地统计/估算”, not account balance.
- Secrets stay server-only in `.env.local`/`.env.server` or an equivalent secret manager. They never enter LocalStorage, frontend bundles, Git, docs, fixtures, ordinary SQLite columns, logs or error messages.

### 4. Freshness and lifecycle

Feed uses three gates: Ingestion Gate, Current Feed Query Gate and HOT/Event Freshness Gate. Ordinary news defaults to 7 days, major operational news to at most 14 days, and official notices/alerts follow explicit effective/expiry rules. Unknown or malformed publication times are quarantined/history-only.

Calendar follows `Server Start → SQLite → UI → background check → sync`; current year and next year are independently tracked by country/year coverage and last success. Calendar freshness is not inferred from Feed age windows.

## Consequences

- V3 can provide a real watchlist and Current Voyage even when Commercial Schedule or a per-port intelligence capability is unavailable.
- The plan can be run at zero external Provider cost, with optional low-cost Discovery/static enrichment and separately budgeted translation.
- More schema and runtime work is required in P0: metadata/bootstrap, ownership isolation, runtime/usage, translation skeleton and secret/config contracts must exist before P2/P6.
- Provider prices, entitlement, public signup and regional availability remain time-sensitive and must be rechecked before implementation.

## Verification required after approval

- Native SQLite restart smoke under the selected Node LTS; no reseed when `vessels` is empty; mutation success only after commit.
- Production bundle scan proves no fixture import, Mock seed or `mock-schedule` in real mode.
- AIS long-lived session and watchlist resubscription tests.
- UN/LOCODE + `Shekou`/`CNSHK`/`蛇口` identity tests without VesselAPI.
- Translation identifier denylist, cache-hit/no-repeat billing, budget stop, secret redaction and usage-label tests.
- Feed 7/14-day/future/unknown/expiry gates and Calendar restart/background-sync tests.
