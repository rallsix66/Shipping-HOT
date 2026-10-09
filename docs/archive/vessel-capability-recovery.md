# Vessel / AIS / Voyage capability recovery (R1 archive)

R1 (ADR-006) retired vessel search/watch, AIS tracking, and voyage/ETA from the product layer. User data was **archived**, not dropped. Use this document when restoring capabilities from history or answering “where did the tables go?”

## Git restore point

- **Tag (planned / branch workflow):** `pre-r1-vessel-removal` — checkout or diff this tag against `codex/shipping-hot-r1-retire-vessel` to recover deleted source files.
- **Migration that archives DB tables:** `server/database/migrations/014-retire-vessel-voyage.ts` (schema **v14**).

## Environment variables (no longer read by product code after R1)

| Variable | Former use |
|----------|------------|
| `GFW_API_TOKEN` | Global Fishing Watch vessel search |
| `VESSELAPI_API_KEY` | VesselAPI search + voyage/ETA |
| `AISSTREAM_API_KEY` | AISStream position streaming |

Secrets may still exist in `.data/provider-secrets.json` on retained machines; they are inert until a future approved re-integration.

## SQLite tables renamed (migration 014)

Each live table was renamed to `_retired_<name>` when present:

- `vessels` → `_retired_vessels`
- `vessel_watchlist` → `_retired_vessel_watchlist`
- `voyages` → `_retired_voyages`
- `vessel_metadata` → `_retired_vessel_metadata`
- `vessel_search_cache` → `_retired_vessel_search_cache`
- `ais_positions` → `_retired_ais_positions`
- `ais_latest_positions` → `_retired_ais_latest_positions`
- `voyage_eta_history` → `_retired_voyage_eta_history`
- `ais_port_metrics` → `_retired_ais_port_metrics`

`feed_items.related_voyage_ids` was dropped when present (column orphaned after voyage retirement).

## Deleted source files (R1 branch `git status` / diff vs base)

### Scripts

- `scripts/p3a-ais-sqlite-smoke.ts`
- `scripts/p3b-voyage-sqlite-smoke.ts`

### API routes

- `server/api/shipping/search/vessels.get.ts`
- `server/api/shipping/search/vessels/watch.delete.ts`
- `server/api/shipping/search/vessels/watch.post.ts`
- `server/api/shipping/search/vessels/watchlist.get.ts`
- `server/api/shipping/vessels/[id]/position.get.ts`
- `server/api/shipping/vessels/[id]/voyage.get.ts`
- Legacy combined `server/api/shipping/watch.post.ts` (vessel+port) — replaced by port-only `watch.post.ts`

### Database / domain

- `server/database/ais-positions.ts`, `server/database/ais-positions.test.ts`
- `server/database/vessel-search.ts`, `server/database/vessel-search.test.ts`
- `server/database/voyages.ts`, `server/database/voyages.test.ts`

### Providers & runtime

- `server/providers/ais/**`
- `server/providers/aisstream-area.ts`, `server/providers/aisstream-area.test.ts`
- `server/providers/vessel-search.ts`, `server/providers/vessel-search.test.ts`
- `server/providers/voyage/**`
- `server/runtime/ais-*.ts` (area sync, live tracker, streaming config, tracking job)
- `server/runtime/voyage-sync-job.ts`, `server/runtime/voyage-sync-job.test.ts`
- `server/search/vessel.ts`, `server/search/vessel-watchlist.ts`, `server/search/vessel-watchlist.test.ts`
- `server/services/ais-position-read.ts`, `server/services/ais-position-api.test.ts`
- `server/services/voyage-read.ts`, `server/services/voyage-read.test.ts`

### Shared types

- `shared/ais-area.ts`, `shared/ais-area.test.ts`, `shared/ais-area-engine.test.ts`
- `shared/vessel-search.ts`, `shared/vessel-search.test.ts`
- `shared/voyage.ts`, `shared/voyage-normalizer.ts`

### UI routes

- `src/routes/vessels.tsx`, `src/routes/vessels_.$id.tsx`
- `src/routes/voyages.tsx`, `src/routes/voyages_.$id.tsx`

(Vessel/voyage pages removed from `src/components/shipping/pages.tsx` and navigation in `app.tsx`.)

## Future UN/LOCODE port impact cards (R4+)

When intel impact cards attach to ports, reuse the existing eight-port directory and `port_directory` UN/LOCODE identities (CNSHK, CNYTN, etc.). Voyage-era `destinationPortId` / focus-port mapping logic is **not** restored automatically; card linkage should key off `portId` / UN/LOCODE from the port-only product model in ADR-006 and the risk-intelligence plan §4.

## Re-opening vessel capabilities

Requires a new architecture decision and approved plan slice—not a silent revert of migration 014. Recovery path: restore code from `pre-r1-vessel-removal`, add a forward migration to rename `_retired_*` tables back (or copy rows into new schemas), re-verify Providers and S7-style acceptance under explicit budget authorization.
