# Shipping HOT V2.0–V2.5 Completion Archive

## 1. Archive Metadata

- Archive date: 2026-08-19
- Final baseline commit: `9e996a4778ff6c7eedd1aacfd9c34ce922efb9cb`
- Scope: V2.0–V2.5 + Real Mode Startup
- Status: Plan Completed

This archive records completion of the V2 development plan. It does not claim that every real source has produced live observations, that the system is fully live, or that the system is production ready.

## 2. Original Goal

Shipping HOT is a personal shipping intelligence system covering ports, vessels, voyages, shipping information, country calendars, weather, Events and HOT prioritization.

The focus ports are:

- Shekou
- Yantian
- Nansha
- Laem Chabang
- Port Klang
- Manila
- Jakarta
- Ho Chi Minh City

## 3. Final Architecture

The retained foundation is React / Vite / TanStack / Nitro / db0 / SQLite, organized around:

- Provider adapters
- Repository persistence and memory fallback
- Domain normalization
- Event Engine reconciliation
- HOT ranking
- Information Feed and Operational Data as separate surfaces

The trust model distinguishes `sourceType`, `dataNature`, `sourceUpdatedAt`, `fetchedAt`, `updatedAt`, `stale` and `sourceStatus`. Provider formats do not leak directly into the Domain or UI, and Mock data remains explicit rather than being presented as real evidence.

## 4. Final Status Matrix

| Phase / boundary | Final status | Scope note |
| --- | --- | --- |
| V2.0 Data Trust Foundation | SEALED | Provenance, freshness, failure and Mock boundaries are closed. |
| V2.1 Port Intelligence | implemented / verified | Portcast public-page adapter and eight-port mapping are verified; Nansha is stale in the latest evidence. |
| V2.2 Country Calendar | SEALED | Calendarific is `verified_live / partial`; official holiday source remains `live pending`. |
| V2.3 Shipping Information Feed | implemented / locally verified | Public Feed real mode is active; some sources remain deferred or `failed_live`. |
| V2.4 Weather Intelligence | implemented / locally verified | Open-Meteo real mode works; JMA/TMD/BMKG remain `live_pending`. |
| V2.5 Trust Boundary | SEALED | AIS Watched/Area and derived-data trust boundaries are closed locally. |
| V2.5 Overall | implemented / locally verified / live pending | Area observation coverage and other live evidence remain pending. |
| Real Mode Startup Contract | SEALED | Startup precedence and safe example configuration are documented and locally verified. |
| Operational Mock Isolation | SEALED | Incompatible Mock data is excluded from current real operational views. |
| Schedule | MOCK ONLY | No real Schedule Provider is part of V2. |
| Native SQLite | PENDING | Node 24 and the installed `better-sqlite3` ABI are incompatible in the current environment. |

## 5. Completed Phases

### V2.0 — Data Trust Foundation

- Goal: establish explicit provenance, data nature, timestamps, freshness and failure semantics.
- Final implementation: Provider → Domain → Repository → Event/HOT/UI carries source-aware evidence; Mock is explicit; same-source last-known behavior and operational source filtering are defined.
- Final status: SEALED.

### V2.1 — Port Intelligence

- Goal: add compliant public port intelligence for the eight focus ports.
- Final implementation: Portcast public-page parsing, visible-field mapping, cache/fingerprint handling, attribution, stale/no-data states and source-aware Port/Event/HOT behavior.
- Final status: implemented / verified.

### V2.2 — Country Calendar

- Goal: provide country holiday facts and actionable reminders for TH, ID, MY, PH and VN.
- Final implementation: Calendarific, official/manual composition boundaries, scope-aware normalization and dedupe, coverage persistence, conflicts, Calendar → Event → HOT reminders and conditional attribution.
- Final status: SEALED; Calendarific is `verified_live / partial`; official holiday source is live pending.

### V2.3 — Shipping Information Feed

- Goal: add a small set of useful shipping information sources without collapsing Feed into Operational Data.
- Final implementation: The Loadstar and Shekou official sources are active in public mode; source-specific failure, publication-time, dedupe, classification, Event and HOT rules are implemented. Maritime Executive remains disabled/failed-live, with other source coverage deferred.
- Final status: implemented / locally verified; public feed real mode active.

### V2.4 — Weather Intelligence

- Goal: provide model weather windows and a bounded official-alert boundary.
- Final implementation: Open-Meteo 24-hour/72-hour/7-day windows and wave/swell fields are implemented with source-aware freshness; JMA/TMD/BMKG adapters have separate contracts and remain independently gated.
- Final status: implemented / locally verified; Open-Meteo real; official sources live pending.

### V2.5 — AIS / Port Derived Intelligence

- Goal: create a bounded, explicitly derived AIS area signal without presenting it as official congestion.
- Final implementation: Watched AIS and Area AIS are separate sessions; Area uses small heuristic boxes, PositionReport-only subscriptions, bounded aggregate metrics, reliable timestamp semantics, finite reconnects and warning-only Event/HOT rules. No raw AIS track table or Portcast field mutation was added.
- Final status: implemented / locally verified / live pending; V2.5 Trust Boundary is SEALED.

## 6. Real Provider Matrix

| Capability | Provider / mode |
| --- | --- |
| Vessel | AISStream |
| Port | Portcast |
| Weather | Open-Meteo |
| Feed | Public Feed |
| Calendar | Calendarific |
| AIS Area | AISStream Area |
| Schedule | Mock only |
| Official alerts | Public contract exists; live pending |

## 7. Trust Boundary Summary

- Real mode never falls back to incompatible Mock data.
- Historical incompatible Mock data may remain in Repository history.
- The current operational API and HOT view exclude incompatible Mock data.
- `mock-schedule` remains the only intentionally operational Mock source.
- A stale or failed provider keeps only same-source last-known data.
- The system does not fabricate `sourceUpdatedAt`.
- AIS Area is estimated/derived intelligence, not official congestion.
- No raw AIS track table is stored.
- Event/HOT requires fresh usable evidence.
- Switching provider mode is not evidence that an old Event resolved.

## 8. Live Evidence at Archive Time

- Portcast: 8 ports responded; 7 were healthy and Nansha was stale in the latest corrected probe.
- Open-Meteo: real provider is working; the recent API smoke returned 7 model items in the current API.
- Public Feed: The Loadstar and Shekou official notices are active; Maritime Executive remains failed/disabled.
- Calendarific: 201 normalized records — TH 36, ID 31, MY 67, PH 37 and VN 30; coverage remains partial.
- AIS Watched: connection verified, with 0 observations in the prior probe.
- AIS Area: connection verified, with 0 PositionReports in the prior 60-second Shekou probe.

These observations are evidence for the stated provider statuses only. They do not establish full real-data coverage or production readiness.

## 9. Known Pending Items

- AISStream Watched: `connection_verified / pending_observation`
- AISStream Area: `connection_verified / coverage_pending`
- JMA: `live_pending`
- TMD: `live_pending`
- BMKG: `live_pending`
- Schedule: still Mock only
- Native SQLite: pending because of the Node 24 / `better-sqlite3` ABI mismatch
- Production Nitro subroute issue: pre-existing separate runtime issue
- GitHub remote CI: no evidence; no remote workflow runs are configured or available

## 10. What Is No Longer in V2 Scope

The following no longer block V2 plan completion:

- waiting for AIS to produce a real vessel position
- adding a real Schedule Provider
- official weather-source live verification
- fixing the SQLite ABI/toolchain mismatch
- fixing the production Nitro subroute runtime issue

These items belong to **Post-V2 Realization / Runtime Follow-up**, which is a real-data coverage and runtime track rather than V2.0–V2.5 plan implementation.

## 11. Final Verdict

```text
V2.0–V2.5 Plan:
COMPLETED

Trust Boundary:
SEALED

Real Mode Startup:
SEALED

Operational Mock Isolation:
SEALED

System Full Realization:
NOT YET COMPLETE

Next Phase:
POST-V2 REAL DATA COVERAGE / RUNTIME FOLLOW-UP
```
