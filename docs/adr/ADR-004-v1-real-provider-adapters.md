# ADR-004: Shipping HOT V1 Real Provider Adapters

- Date: 2026-08-13
- Status: accepted and implemented for V1 only
- Decision owners: User
- Supersedes: the real-provider deferral statements for V1 in ADR-001/002/003

## Context

Shipping HOT V1 needs one real Vessel source and one real Weather source while retaining the sealed local Mock core. The user explicitly approved the limited change to AISStream Vessel, Open-Meteo Marine Weather, fallback behavior, runtime verification and documentation.

## Decision

- Use AISStream as the optional real Vessel adapter.
- Use Open-Meteo Marine API plus the existing Open-Meteo Forecast API as the optional real Weather adapter.
- Keep provider-specific payloads inside `server/providers/shipping.ts`.
- Continue sending normalized `Vessel[]` and `FeedItem[]` through `shipping-store.ts`, the existing merge rules, Repository, Event Engine and HOT query.
- Keep Mock Providers as the default only when the environment does not select a real Provider. If a real mode is explicitly selected but its required key is absent, retain that requested mode and return no data/`never_succeeded`; never silently switch to Mock.
- Keep all keys server-side in environment variables; never persist or return them.
- Keep Port and Schedule as Mock in V1. Do not add a Port congestion Provider.

## Runtime modes

- Vessel: `SHIPPING_VESSEL_PROVIDER=aisstream` selects AISStream mode; with no `AISSTREAM_API_KEY`, the mode remains `aisstream` and returns no data/`never_succeeded`. When AISStream is not requested, Mock is selected.
- Weather: `SHIPPING_WEATHER_PROVIDER=open-meteo` selects Open-Meteo; otherwise Mock is selected.
- Provider failures preserve only same-provider last-known data through the existing `providerResult()` boundary and mark returned entities stale/failed; with no same-provider history, they return no data.
- No-key, disabled and no-watched-MMSI paths do not fabricate fresh real-time data.
- AIS input is split into `VesselWatchTarget` identity/control records and an optional same-source AIS last-known observation list. Mock Vessel dynamic fields are never passed into the AIS adapter.
- AIS normalization retains only target identity plus fields proven by the current PositionReport; `statusChangedAt` is derived from the first continuously observed timestamp of the current navigation state and is not a guaranteed real-world transition timestamp.
- Open-Meteo model records keep `updatedAt` as the forecast/current valid time, leave `sourceUpdatedAt` undefined unless a reliable source/model-run timestamp is explicitly supplied, and use local request completion for `fetchedAt`; `generationtime_ms` is not a source timestamp.
- The later V2.1 Portcast adapter uses the public HCM `/port-congestion/ho-chi-minh` path, applies a 14-day source-age gate, and prevents stale or date-unknown Portcast values from creating new Port congestion Events/HOT items. Shekou's later official Feed adapter consumes `/ywgg/` operational notices only; publication time remains unknown when the page gives no date and is never replaced by `fetchedAt`.
- `status_changed_at` is nullable in the existing `vessels` table. Startup performs an idempotent table rebuild only when an older NOT NULL schema is detected, preserving rows and watch state; no new domain table or ORM is introduced.
- Entity Event dedupe identity is source-scoped (`logical key + provenance.sourceId`) so Mock and AIS histories can coexist. Historical Events remain in SQLite across mode changes, but current Event/HOT input accepts only Events whose provenance `sourceId` is compatible with the active Provider mode and active source registry. A Provider switch is not evidence that an old Event resolved.
- Calendar composite configuration exposes provenance source IDs rather than option keys: Mock activates `mock-calendar`; Calendarific with a key activates `calendarific`, `official-holiday-source` and `manual-holiday`; missing Calendarific configuration activates only the unavailable `calendarific` source; Official and Manual activate only their actual composite sources. Current Calendar/Event/HOT reads use this configured source set.

## Scope limits

This decision does not approve V2 features, AIS history, global vessel data, multiple real Providers, Port commercial APIs, maps, notifications, AI, deployment, general schema migrations, new domain tables or new dependencies. The existing-vessel nullable compatibility rebuild described above is limited to this final isolation boundary.

## Verification

Offline tests cover normalization, malformed/error payloads, requested-mode/no-data behavior when a key is absent, disabled behavior, watched-MMSI filtering, AIS watch-target/observation isolation, same-source status duration, cross-source merge protection, stale handling, Portcast source-age boundaries and HCM URL mapping, Open-Meteo timestamp roles/windows/directions, source-specific Shekou `/ywgg/` parsing and Event/HOT flow, weather-feed isolation, source-scoped Event identity, registry-aware Event/HOT filtering, Calendar provenance source activation and normalized Calendar → Event → HOT flow. The current local suite is 170/170; no-network provider-mode smoke and Python stdlib SQLite migration smoke passed in the preceding isolation batch. Native better-sqlite3 runtime remains pending because Node 24.15.0 is incompatible with the bundled module ABI; corrected public external-provider re-probe remains pending.
