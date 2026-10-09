# ADR-008: External Data Sources for Intel, Weather, and Vectors

- Date: 2026-10-09
- Status: **Accepted (user sign-off 2026-10-09)**
- Decision owners: User
- Authoritative catalog: **`docs/intel-source-catalog.md`** (sole runtime seed list for intel sources)
- Related: ADR-007; plan §4.8, §5.4; R1.5 weather/calendar/policy tables

## Context

Risk intelligence requires new or expanded external inputs beyond the sealed V3 port/feed/weather slice: land forecast and tropical cyclone tracks, official CAP/API weather alerts per country, Open-Meteo forecast terms, JMA typhoon data, operational calendar events (promo rules, manual port/customs closures), policy library storage, and embedding API access. The user approved the third plan and intel source catalog on 2026-09-30, including dependency additions and “eight ports only, no last-mile city granularity.”

## Decision

### 1. Scope boundaries

- **Ports**: remain the existing eight UN/LOCODE identities; no port expansion in this round.
- **Last-mile cities**: not in scope; delivery impact stays port- and official-alert–bounded.
- **Headless browser fetching**: not authorized in R2; revisit only at R2-X after R2 closeout.
- **Reference vs intel**: annual bundled calendar (`server/data/annual-calendar/`) stays provider-free; `ops_calendar_event`, `policy_*`, and intel tables are separate and must not mutate reference JSON or operational readiness semantics.

### 2. Approved source classes (implementation by stage)

| Area | Sources / APIs | Stage | Notes |
| --- | --- | --- | --- |
| Land + marine forecast | Open-Meteo Forecast + existing Open-Meteo Marine | R1.5 | Free tier for dev/demo; **L-stage** user decision on commercial license before public production (plan §4.8) |
| Tropical cyclone | JMA primary, JTWC fallback; **CN-W01**（中央气象台台风，`web_list`，国内起运参考） | R1.5 | Display rules: region bbox + 1000 km port proximity；CN-W01 可与 JMA/JTWC 并列展示，链路环节 **① 起运港** |
| Official weather alerts | TMD CAP; MetMalaysia API; NCHMF; PAGASA; retain BMKG where already integrated; **CN-W02**（中央气象台全国预警，`web_list`） | R1.5 | Per catalog IDs；**CN-W01**、**CN-W02** 均映射环节 **① 起运港**（中国侧起运/离港天气与预警） |
| China holidays | CN-H01 manual/bundled seed | R1.5 | Alongside five-country annual reference |
| E-commerce promos | Catalog §9 rules → `ops_calendar_event` with basis metadata | R1.5 | Rule-generated = “待确认” until confirmed |
| Policy library | Manual entry first; auto from intel types in R3 | R1.5 / R3 | Long-retention versions |
| Intel RSS/web/json/manual | Catalog §1–§8 | R2+ | `intel_source.catalog_id` maps 1:1 to catalog rows |
| Embeddings | Alibaba Bailian (plan A) | R3 | Not DeepSeek; configured via ADR-007 bindings |

### 3. Dependencies (plan §5.4)

Approved to add when first needed (not in R0): `zod`, `@mozilla/readability`, `linkedom`, `undici`, `p-limit`. Existing `cheerio`, `fast-xml-parser` reused.

### 4. Terms and attribution

- Open-Meteo, BMKG, and other catalog entries with commercial-use ambiguity follow plan §4.8 and catalog footnotes: dev/demo may use free tiers with attribution; **production/commercial deployment requires explicit user authorization** per source before go-live (L stage).
- SCFI and other user-declined sources (e.g. XX-R01) stay **not connected**.

### 5. Schema naming (R1.5+)

Operational weather/intel/policy tables use names in plan §3: `weather_forecast`, `weather_impact`, `tropical_cyclone`, `ops_calendar_event`, `policy_record`, `policy_version`, plus intel `intel_*` set in ADR-007. First migration tranche: **`014-ops-weather-calendar-policy`** (exact split may be refined in R1.5 PR; must remain additive from v13).

## Consequences

- Live Provider verification remains stage-gated; catalog `OK` does not imply live keys or paid budgets configured.
- JMA “disabled/live-pending” on main until R1.5 implementation replaces historical status in `docs/status.md` when evidenced.

## R0 scope

Catalog file and ADR only; no new Providers, env vars, or migrations in R0.
