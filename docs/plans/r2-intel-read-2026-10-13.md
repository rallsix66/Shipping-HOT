# R2 intel read-only API - 2026-10-13

Authorized slice under the 9/29 plan: persisted intelligence reads only. No table/migration, business-page changes, write/enable/run-now route, provider registration change or real source activation.

## Minimal HTTP contract

| GET path | Query | Returned public fields |
| --- | --- | --- |
| /api/shipping/intel/sources | sourceId optional, limit/offset | page items: id/catalogId/name/kind/persistence, status/consecutiveFailures/nextSyncAt/lastRunAt/lastOkAt, recentRuns (max 5): id/sourceId/startedAt/finishedAt/status/itemsSeen/itemsNew/itemsRevised |
| /api/shipping/intel/items | sourceId optional, limit/offset | page items: id/sourceId/title/publishedAt/firstSeenAt/lastSeenAt/currentVersionId/canonicalUrl (nullable public URL) |
| /api/shipping/intel/items/:id | versionId optional, limit/offset for versions | item/source public DTO, versions page, selectedVersion (current by default): id/itemId/fetchedAt/createdAt/effective contentScope/dateEvidence/blocks |

Paging: default limit20/offset0, limit1..50, offset0..10000; strict decimal scalar strings, no duplicate/unknown query keys. Stable deterministic ordering, page includes items/limit/offset/hasMore. SourceId filters and IDs unknown return404; malformed queries400; unavailable/uninitialized data503, fixed error body without stack/SQL/caller URL. Empty collections return200/items[]. IDs bounded160 chars. No request triggers initialization or recovery.

Public fields are selected explicitly. No source URL, CA/headers/credentials/secret metadata, raw errorCode/errorMessage, executor/internal config/content hash is returned. Date evidence whitelists raw/rule/basis/calendar/precision/timezone/offset/localDate/publishedAt, clipping text and redacting credential/PEM markers. HTTPS item URLs with userinfo or credential-like query keys are null, not unredacted links. Version content is persisted publication text, not raw transport/request metadata.

License: effective scope=min(current source persistence, stored version scope). Current full cannot expand an excerpt/metadata-only version; current excerpt caps even historical full text at280 chars; disallowed/metadata-only returns only headline metadata. The collector's existing licensedBlocks renderer moved unchanged to a pure module, avoiding any read import of the network collector. GET never writes a redacted/transformed value back. no-store prevents cached earlier full-scope responses being served after policy changes.

## Verification boundary

Actual H3 HTTP handlers on a local loopback server, isolated native SQLite, query_only=ON during requests and whole-table snapshots. External fetch is intercepted; the read dependency closure is asserted to consist only of H3, SELECT repository methods and pure license code, with no runtime/provider/LLM/collector/init/recovery imports. This is not counter-only proof. Tests cover persisted/historical versions and date evidence, failed sources, privacy, license tightening, empty/unknown/missing-schema responses and parameter/paging bounds.

Existing S7 harness (no second harness/seed): align expected schema20 with current approved27, add production-built empty intel source/item routes, coded detail404/paging400, repeated reads and whole-DB snapshot. Keep prior flows/provider/egress/retained-DB checks and run isolated fresh directory. No business UI change. Final code-SHA gate/S7/Neat Freak evidence belongs in docs/status.md.

Runtime stays default disabled. Production ownership adapter/live sources, GET business UI, P1 full real fixtures, manual input, 304/ETag and24h live acceptance remain separately unverified. Parent review PASS for 4e36813/a9e637f; offline GET slice closed, R2 overall incomplete.

Local verification completed on clean code `4e36813eb8859f4fb4d658f8cacdedde5b6275ad`: actual HTTP16, full1024 passed/3 skipped, existing production S7 162/162; full gate exits and actual Neat Freak closeout in `docs/evidence/gate-4e36813/`. Generated untracked evidence explains S7 workspaceClean=false; no tracked code changed during testing. Parent review subsequently PASS (2026-10-13); saved tests are executor evidence, not an independent parent rerun.
