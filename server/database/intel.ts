import { randomUUID } from "node:crypto"
import type { Database } from "db0"
import type { WebDate } from "#/intel/sources/web-list"

export type IntelPersistence = "full" | "excerpt_only" | "disallowed"
export type IntelContentScope = "full_text" | "excerpt" | "metadata_only"
export type IntelSourceStatus = "never_run" | "ok" | "ok_empty" | "failing"
export type IntelRunStatus = "running" | "ok_items" | "ok_empty" | "failed"
export type IntelBlockType = "title" | "paragraph" | "excerpt"

export interface IntelSourceRecord {
  id: string
  catalogId: string
  name: string
  kind: "rss" | "atom" | "rdf" | "web_list" | "json_list"
  url: string
  persistence: IntelPersistence
  enabled: boolean
  status: IntelSourceStatus
  consecutiveFailures: number
  nextSyncAt: string | null
  lastRunAt: string | null
  lastOkAt: string | null
  lastErrorCode: string | null
}

export interface IntelRunRecord {
  id: string
  sourceId: string
  startedAt: string
  finishedAt: string | null
  status: IntelRunStatus
  itemsSeen: number
  itemsNew: number
  itemsRevised: number
  errorCode: string | null
}

export interface IntelVersionRecord {
  dateEvidence: WebDate | null
  id: string
  itemId: string
  contentHash: string
  contentScope: IntelContentScope
  extractorVersion: string
  fetchedAt: string
  createdAt: string
}

export interface IntelBlock {
  blockKey: string
  order: number
  type: IntelBlockType
  text: string
}

export interface IntelCurrentChange {
  itemId: string
  fromVersionId: string | null
  toVersionId: string
  reason: "new_version" | "restored_version"
  changedAt: string
}

export type IntelWriteOutcome = "created" | "unchanged" | "revised" | "restored"

export interface IntelItemRecord {
  id: string
  sourceId: string
  canonicalUrl: string
  title: string
  publishedAt: string | null
  firstSeenAt: string
  lastSeenAt: string
  currentVersionId: string | null
}

export interface IntelEntryWrite {
  dateEvidence?: WebDate
  sourceId: string
  canonicalUrl: string
  title: string
  publishedAt?: string
  sourceUpdatedAt?: string
  contentHash: string
  contentScope: IntelContentScope
  extractorVersion: string
  blocks: IntelBlock[]
  fetchedAt: string
}

type Row = Record<string, unknown>
const str = (value: unknown): string | null => (value === null || value === undefined ? null : String(value))

function mapSource(row: Row): IntelSourceRecord {
  return {
    id: String(row.id),
    catalogId: String(row.catalog_id),
    name: String(row.name),
    kind: row.kind as IntelSourceRecord["kind"],
    url: String(row.url),
    persistence: row.persistence as IntelPersistence,
    enabled: Number(row.enabled) === 1,
    status: row.status as IntelSourceStatus,
    consecutiveFailures: Number(row.consecutive_failures),
    nextSyncAt: str(row.next_sync_at),
    lastRunAt: str(row.last_run_at),
    lastOkAt: str(row.last_ok_at),
    lastErrorCode: str(row.last_error_code),
  }
}

function mapRun(row: Row): IntelRunRecord {
  return {
    id: String(row.id),
    sourceId: String(row.source_id),
    startedAt: String(row.started_at),
    finishedAt: str(row.finished_at),
    status: row.status as IntelRunStatus,
    itemsSeen: Number(row.items_seen),
    itemsNew: Number(row.items_new),
    itemsRevised: Number(row.items_revised),
    errorCode: str(row.error_code),
  }
}

/** Repository for the R2 intel tables (021/022). Reads never trigger fetching. */
export class IntelRepository {
  constructor(private readonly db: Database) {}

  private async transaction<T>(work: () => Promise<T>): Promise<T> {
    await this.db.prepare("BEGIN IMMEDIATE").run()
    try {
      const result = await work()
      await this.db.prepare("COMMIT").run()
      return result
    } catch (error) {
      try {
        await this.db.prepare("ROLLBACK").run()
      } catch {
        // keep the original error
      }
      throw error
    }
  }

  async upsertSource(source: Pick<IntelSourceRecord, "id" | "catalogId" | "name" | "kind" | "url" | "persistence" | "enabled">, now: string): Promise<void> {
    await this.db.prepare(`
      INSERT INTO intel_source (id, catalog_id, name, kind, url, persistence, enabled, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        catalog_id = excluded.catalog_id, name = excluded.name, kind = excluded.kind, url = excluded.url,
        persistence = excluded.persistence, enabled = excluded.enabled, updated_at = excluded.updated_at
    `).run(source.id, source.catalogId, source.name, source.kind, source.url, source.persistence, source.enabled ? 1 : 0, now)
  }

  async getSource(id: string): Promise<IntelSourceRecord | undefined> {
    const row = await this.db.prepare("SELECT * FROM intel_source WHERE id = ?").get(id) as Row | undefined
    return row ? mapSource(row) : undefined
  }

  async listDueSources(now: string): Promise<IntelSourceRecord[]> {
    const rows = await this.db.prepare("SELECT * FROM intel_source WHERE enabled = 1 AND (next_sync_at IS NULL OR next_sync_at <= ?) ORDER BY id").all(now) as Row[]
    return rows.map(mapSource)
  }

  async registerExecutor(id: string, now: string): Promise<void> {
    await this.db.prepare("INSERT INTO intel_executor (id, started_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING").run(id, now)
  }

  /** Confirms an executor has stopped; only then may its leftover runs be recovered by another executor. */
  async endExecutor(id: string, now: string): Promise<void> {
    await this.db.prepare("UPDATE intel_executor SET ended_at = ? WHERE id = ? AND ended_at IS NULL").run(now, id)
  }

  /** Returns null when this source already has a run in flight (unique partial index). */
  async beginRun(sourceId: string, now: string, executorId: string | null = null): Promise<string | null> {
    const id = randomUUID()
    try {
      await this.db.prepare("INSERT INTO intel_fetch_run (id, source_id, started_at, status, executor_id) VALUES (?, ?, ?, 'running', ?)").run(id, sourceId, now, executorId)
      return id
    } catch (error) {
      if (error instanceof Error && /UNIQUE constraint failed/i.test(error.message)) return null
      throw error
    }
  }

  async completeRun(id: string, result: { status: Exclude<IntelRunStatus, "running">, finishedAt: string, itemsSeen?: number, itemsNew?: number, itemsRevised?: number, errorCode?: string | null, errorMessage?: string | null }): Promise<void> {
    await this.db.prepare(`
      UPDATE intel_fetch_run SET status = ?, finished_at = ?, items_seen = ?, items_new = ?, items_revised = ?, error_code = ?, error_message = ?
      WHERE id = ? AND status = 'running'
    `).run(result.status, result.finishedAt, result.itemsSeen ?? 0, result.itemsNew ?? 0, result.itemsRevised ?? 0, result.errorCode ?? null, result.errorMessage ?? null, id)
  }

  /** Closes runs left 'running' by executors that are confirmed ended (ended_at set). Safe while other executors are live. */
  async recoverRunsOfEndedExecutors(now: string): Promise<number> {
    const result = await this.db.prepare(`
      UPDATE intel_fetch_run SET status = 'failed', finished_at = ?, error_code = 'interrupted', error_message = 'executor ended while run was in flight'
      WHERE status = 'running' AND executor_id IN (SELECT id FROM intel_executor WHERE ended_at IS NOT NULL)
    `).run(now) as { changes?: number }
    return Number(result.changes ?? 0)
  }

  /**
   * Explicit, exclusive startup recovery: closes every leftover 'running' run and marks every unended executor as
   * ended. The caller must guarantee exclusivity (process startup, before any intel executor of this deployment runs;
   * the current deployment is a single local process). It is never called implicitly by a job instance.
   */
  async recoverAllRunsAtExclusiveStartup(now: string): Promise<number> {
    return this.transaction(async () => {
      const result = await this.db.prepare(`
        UPDATE intel_fetch_run SET status = 'failed', finished_at = ?, error_code = 'interrupted', error_message = 'recovered by exclusive startup step'
        WHERE status = 'running'
      `).run(now) as { changes?: number }
      await this.db.prepare("UPDATE intel_executor SET ended_at = ? WHERE ended_at IS NULL").run(now)
      return Number(result.changes ?? 0)
    })
  }

  async listRuns(sourceId: string): Promise<IntelRunRecord[]> {
    const rows = await this.db.prepare("SELECT * FROM intel_fetch_run WHERE source_id = ? ORDER BY started_at, rowid").all(sourceId) as Row[]
    return rows.map(mapRun)
  }

  async recordSourceSuccess(sourceId: string, input: { status: "ok" | "ok_empty", now: string, nextSyncAt: string }): Promise<void> {
    await this.db.prepare(`
      UPDATE intel_source SET status = ?, consecutive_failures = 0, next_sync_at = ?, last_run_at = ?, last_ok_at = ?, last_error_code = NULL, updated_at = ?
      WHERE id = ?
    `).run(input.status, input.nextSyncAt, input.now, input.now, input.now, sourceId)
  }

  async recordSourceFailure(sourceId: string, input: { now: string, nextSyncAt: string, errorCode: string, consecutiveFailures: number }): Promise<void> {
    await this.db.prepare(`
      UPDATE intel_source SET status = 'failing', consecutive_failures = ?, next_sync_at = ?, last_run_at = ?, last_error_code = ?, updated_at = ?
      WHERE id = ?
    `).run(input.consecutiveFailures, input.nextSyncAt, input.now, input.errorCode, input.now, sourceId)
  }

  /** Success finish: run result and source state commit in one transaction, or neither does. */
  async finishRunSuccess(runId: string, sourceId: string, run: Parameters<IntelRepository["completeRun"]>[1], source: Parameters<IntelRepository["recordSourceSuccess"]>[1]): Promise<void> {
    await this.transaction(async () => {
      await this.completeRun(runId, run)
      await this.recordSourceSuccess(sourceId, source)
    })
  }

  /** Failure finish: run result and source backoff commit in one transaction, or neither does. */
  async finishRunFailure(runId: string, sourceId: string, run: Parameters<IntelRepository["completeRun"]>[1], source: Parameters<IntelRepository["recordSourceFailure"]>[1]): Promise<void> {
    await this.transaction(async () => {
      await this.completeRun(runId, run)
      await this.recordSourceFailure(sourceId, source)
    })
  }

  private async recordCurrentChange(itemId: string, fromVersionId: string | null, toVersionId: string, reason: IntelCurrentChange["reason"], changedAt: string): Promise<void> {
    await this.db.prepare(`
      INSERT INTO intel_item_current_change (id, item_id, from_version_id, to_version_id, reason, changed_at) VALUES (?, ?, ?, ?, ?, ?)
    `).run(randomUUID(), itemId, fromVersionId, toVersionId, reason, changedAt)
  }

  /**
   * Dedupe on (source, canonical URL); versions are immutable and unique per content hash.
   * - same hash as the current version → unchanged (only last_seen_at moves)
   * - same hash as an older version (A→B→A) → current pointer and current metadata restored to that version,
   *   change recorded; no duplicate version or blocks
   * - new hash → new version, change recorded; old versions untouched
   */
  async writeEntry(entry: IntelEntryWrite): Promise<{ outcome: IntelWriteOutcome, created: boolean, revised: boolean, itemId: string, versionId: string }> {
    return this.transaction(async () => {
      const existing = await this.db.prepare("SELECT * FROM intel_item WHERE source_id = ? AND canonical_url = ?").get(entry.sourceId, entry.canonicalUrl) as Row | undefined
      const itemId = existing ? String(existing.id) : randomUUID()
      const currentVersionId = existing ? str(existing.current_version_id) : null
      if (!existing) {
        await this.db.prepare(`
          INSERT INTO intel_item (id, source_id, canonical_url, title, published_at, first_seen_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(itemId, entry.sourceId, entry.canonicalUrl, entry.title, entry.publishedAt ?? null, entry.fetchedAt, entry.fetchedAt)
      }
      const matched = await this.db.prepare("SELECT id FROM intel_item_version WHERE item_id = ? AND content_hash = ?").get(itemId, entry.contentHash) as Row | undefined
      if (matched) {
        const versionId = String(matched.id)
        if (versionId === currentVersionId) {
          await this.db.prepare("UPDATE intel_item SET last_seen_at = ? WHERE id = ?").run(entry.fetchedAt, itemId)
          return { outcome: "unchanged", created: false, revised: false, itemId, versionId }
        }
        await this.db.prepare("UPDATE intel_item SET title = ?, published_at = ?, last_seen_at = ?, current_version_id = ? WHERE id = ?")
          .run(entry.title, entry.publishedAt ?? null, entry.fetchedAt, versionId, itemId)
        await this.recordCurrentChange(itemId, currentVersionId, versionId, "restored_version", entry.fetchedAt)
        return { outcome: "restored", created: false, revised: true, itemId, versionId }
      }
      const versionId = randomUUID()
      await this.db.prepare(`
        INSERT INTO intel_item_version (id, item_id, content_hash, fetched_at, extractor_version, content_scope, source_published_at, source_updated_at, created_at, date_evidence)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(versionId, itemId, entry.contentHash, entry.fetchedAt, entry.extractorVersion, entry.contentScope, entry.publishedAt ?? null, entry.sourceUpdatedAt ?? null, entry.fetchedAt, entry.dateEvidence ? JSON.stringify(entry.dateEvidence) : null)
      for (const block of entry.blocks) {
        await this.db.prepare(`
          INSERT INTO intel_item_block (id, version_id, block_key, block_order, block_type, text) VALUES (?, ?, ?, ?, ?, ?)
        `).run(randomUUID(), versionId, block.blockKey, block.order, block.type, block.text)
      }
      await this.db.prepare("UPDATE intel_item SET title = ?, published_at = ?, last_seen_at = ?, current_version_id = ? WHERE id = ?")
        .run(entry.title, entry.publishedAt ?? null, entry.fetchedAt, versionId, itemId)
      await this.recordCurrentChange(itemId, currentVersionId, versionId, "new_version", entry.fetchedAt)
      return { outcome: existing ? "revised" : "created", created: !existing, revised: Boolean(existing), itemId, versionId }
    })
  }

  async listCurrentChanges(itemId: string): Promise<IntelCurrentChange[]> {
    const rows = await this.db.prepare("SELECT * FROM intel_item_current_change WHERE item_id = ? ORDER BY changed_at, rowid").all(itemId) as Row[]
    return rows.map(row => ({
      itemId: String(row.item_id),
      fromVersionId: str(row.from_version_id),
      toVersionId: String(row.to_version_id),
      reason: row.reason as IntelCurrentChange["reason"],
      changedAt: String(row.changed_at),
    }))
  }

  async listItems(sourceId: string): Promise<IntelItemRecord[]> {
    const rows = await this.db.prepare("SELECT * FROM intel_item WHERE source_id = ? ORDER BY canonical_url").all(sourceId) as Row[]
    return rows.map(row => ({
      id: String(row.id),
      sourceId: String(row.source_id),
      canonicalUrl: String(row.canonical_url),
      title: String(row.title),
      publishedAt: str(row.published_at),
      firstSeenAt: String(row.first_seen_at),
      lastSeenAt: String(row.last_seen_at),
      currentVersionId: str(row.current_version_id),
    }))
  }

  async listVersions(itemId: string): Promise<IntelVersionRecord[]> {
    const rows = await this.db.prepare("SELECT * FROM intel_item_version WHERE item_id = ? ORDER BY created_at DESC, rowid DESC").all(itemId) as Row[]
    return rows.map(row => ({
      id: String(row.id),
      itemId: String(row.item_id),
      contentHash: String(row.content_hash),
      dateEvidence: row.date_evidence == null ? null : JSON.parse(String(row.date_evidence)) as WebDate,
      contentScope: row.content_scope as IntelContentScope,
      extractorVersion: String(row.extractor_version),
      fetchedAt: String(row.fetched_at),
      createdAt: String(row.created_at),
    }))
  }

  async readVersionBlocks(versionId: string): Promise<IntelBlock[]> {
    const rows = await this.db.prepare("SELECT * FROM intel_item_block WHERE version_id = ? ORDER BY block_order").all(versionId) as Row[]
    return rows.map(row => ({ blockKey: String(row.block_key), order: Number(row.block_order), type: row.block_type as IntelBlockType, text: String(row.text) }))
  }
}
