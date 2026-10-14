import { type H3Event, defineEventHandler, getQuery, getRouterParam, setResponseHeader, setResponseStatus } from "h3"
import { type IntelContentScope, type IntelItemRecord, IntelRepository, type IntelSourceRecord, type IntelVersionRecord } from "#/database/intel"
import { licensedBlocks } from "#/intel/content-license"
import { manualCatalog } from "#/intel/manual-catalog"
import { manualPersistenceFor } from "#/intel/manual-license"

class IntelReadError extends Error {
  constructor(readonly statusCode: number, message: string) {
    super(message)
  }
}
function missing(name: string): never {
  throw new IntelReadError(404, `Unknown intel ${name}`)
}
function invalid(): never {
  throw new IntelReadError(400, "Invalid intel query")
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[\w:.-]{1,160}$/.test(value)) return invalid()
  return value
}
function integer(value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined) return fallback
  if (typeof value !== "string" || !/^(?:0|[1-9]\d*)$/.test(value)) return invalid()
  const n = Number(value)
  return Number.isSafeInteger(n) && n >= min && n <= max ? n : invalid()
}
function query(event: H3Event, keys: string[]) {
  const q = getQuery(event)
  if (Object.keys(q).some(key => !["limit", "offset", ...keys].includes(key))) invalid()
  return { limit: integer(q.limit, 20, 1, 50), offset: integer(q.offset, 0, 0, 10000), q }
}
function page<T>(rows: T[], limit: number, offset: number) {
  return { items: rows.slice(0, limit), limit, offset, hasMore: rows.length > limit }
}
function publicText(value: unknown): string | null {
  if (typeof value !== "string") return null
  if (/-----BEGIN [A-Z ]+-----|\b(?:authorization|bearer|cookie|set-cookie|api[_-]?key|password|token|credential|signature|secret)\b/i.test(value)) return "[redacted]"
  return value.slice(0, 500)
}
function publicUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password || [...url.searchParams.keys()].some(key => /key|token|secret|password|auth|credential|signature|cookie|csrf|(?:^|[_-])sig(?:$|[_-])/i.test(key))) return null
    return url.toString()
  } catch {
    return null
  }
}
function sourceDto(source: IntelSourceRecord) {
  return { id: source.id, catalogId: source.catalogId, name: publicText(source.name), kind: source.kind, persistence: source.persistence, status: source.status, consecutiveFailures: source.consecutiveFailures, nextSyncAt: source.nextSyncAt, lastRunAt: source.lastRunAt, lastOkAt: source.lastOkAt }
}
function itemDto(item: IntelItemRecord) {
  return { id: item.id, sourceId: item.sourceId, title: item.title, publishedAt: item.publishedAt, firstSeenAt: item.firstSeenAt, lastSeenAt: item.lastSeenAt, currentVersionId: item.currentVersionId, canonicalUrl: publicUrl(item.canonicalUrl) }
}
function scope(source: IntelSourceRecord, version: IntelVersionRecord, manualUrl?: string): IntelContentScope {
  const persistence = manualUrl === undefined ? source.persistence : manualPersistenceFor(source, manualUrl)
  const a = persistence === "full" ? 2 : persistence === "excerpt_only" ? 1 : 0
  const b = version.contentScope === "full_text" ? 2 : version.contentScope === "excerpt" ? 1 : 0
  return (["metadata_only", "excerpt", "full_text"] as const)[Math.min(a, b)]
}
function versionDto(version: IntelVersionRecord, source: IntelSourceRecord, manualUrl?: string) {
  const e = version.dateEvidence
  const dateEvidence = e
    ? {
        raw: publicText(e.raw),
        rule: publicText(e.rule),
        basis: publicText(e.basis),
        calendar: ["gregorian", "buddhist"].includes(e.calendar) ? e.calendar : null,
        precision: ["unknown", "day", "minute", "second", "millisecond"].includes(e.precision) ? e.precision : "unknown",
        timezone: ["missing", "explicit", "configured"].includes(e.timezone) ? e.timezone : "missing",
        utcOffset: typeof e.utcOffset === "string" && /^[+-](?:0\d|1[0-3]):[0-5]\d$|^[+-]14:00$/.test(e.utcOffset) ? e.utcOffset : null,
        localDate: typeof e.localDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(e.localDate) ? e.localDate : null,
        publishedAt: typeof e.publishedAt === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(e.publishedAt) ? e.publishedAt : null,
      }
    : null
  return { id: version.id, itemId: version.itemId, publishedAt: version.sourcePublishedAt, fetchedAt: version.fetchedAt, createdAt: version.createdAt, contentScope: scope(source, version, manualUrl), dateEvidence }
}

/** Read-only adapter: no initialization, runtime, provider or recovery dependency. */
export function intelReadHandler(read: (event: H3Event, repository: IntelRepository) => Promise<unknown>) {
  return defineEventHandler(async (event) => {
    setResponseHeader(event, "Cache-Control", "no-store")
    try {
      return await read(event, new IntelRepository(useDatabase()))
    } catch (error) {
      const statusCode = error instanceof IntelReadError ? error.statusCode : 503
      const statusMessage = error instanceof IntelReadError ? error.message : "Intel data unavailable"
      setResponseStatus(event, statusCode)
      return { statusCode, statusMessage }
    }
  })
}

export async function readIntelSources(event: H3Event, repo: IntelRepository) {
  const { q, limit, offset } = query(event, ["sourceId"])
  const sourceId = q.sourceId === undefined ? undefined : id(q.sourceId)
  if (sourceId && !await repo.getSource(sourceId)) missing("source")
  const sources = await repo.listSourcesPage(limit + 1, offset, sourceId)
  const rows = await Promise.all(sources.slice(0, limit).map(async source => ({ ...sourceDto(source), recentRuns: (await repo.listRecentRuns(source.id)).map(run => ({ id: run.id, sourceId: run.sourceId, startedAt: run.startedAt, finishedAt: run.finishedAt, status: run.status, itemsSeen: run.itemsSeen, itemsNew: run.itemsNew, itemsRevised: run.itemsRevised })) })))
  return { ...page(rows, limit, offset), hasMore: sources.length > limit }
}
export async function readIntelItems(event: H3Event, repo: IntelRepository) {
  const { q, limit, offset } = query(event, ["sourceId"])
  const sourceId = q.sourceId === undefined ? undefined : id(q.sourceId)
  if (sourceId && !await repo.getSource(sourceId)) missing("source")
  const rows = await repo.listItemsPage(limit + 1, offset, sourceId)
  const items = await Promise.all(rows.map(async (item) => {
    const latest = item.currentVersionId ? await repo.getManualVersionAction(item.sourceId, item.id, item.currentVersionId) : undefined
    return { ...itemDto(item), manualEntry: latest ? { operator: latest.operator, enteredAt: latest.entered_at } : null }
  }))
  return page(items, limit, offset)
}
export async function readIntelItem(event: H3Event, repo: IntelRepository) {
  const { q, limit, offset } = query(event, ["versionId"])
  const item = await repo.getItem(id(getRouterParam(event, "id")))
  if (!item) return missing("item")
  const source = await repo.getSource(item.sourceId)
  if (!source) return missing("source")
  const versionId = q.versionId === undefined ? item.currentVersionId : id(q.versionId)
  const selected = versionId ? await repo.getVersion(item.id, versionId) : undefined
  if (versionId && !selected) return missing("version")
  const versions = await repo.listVersionsPage(item.id, limit + 1, offset)
  const blocks = selected ? await repo.readVersionBlocks(selected.id) : []
  const selectedManual = selected ? await repo.getManualVersionAction(source.id, item.id, selected.id) : undefined
  const manualUrl = selectedManual ? item.canonicalUrl : undefined
  const permitted = selected ? scope(source, selected, manualUrl) : "metadata_only"
  const title = blocks.find(block => block.type === "title")?.text ?? item.title
  const safeBlocks = permitted === "full_text" ? blocks : licensedBlocks(permitted, title, blocks.filter(block => block.type !== "title").map(block => block.text).join(""))
  const manualActions = await repo.listManualActions(source.id, item.id)
  const grade = manualCatalog.find(row => row.catalogId === source.catalogId)?.grade ?? (["TH-W01", "ID-W01"].includes(source.catalogId) ? "A" : "unknown")
  const manualLabel = selectedManual ? grade === "A" ? "官方通知（人工录入）" : grade === "unknown" ? "资讯（人工录入，类型未核验）" : "报道（人工录入）" : null
  const versionRows = await Promise.all(versions.map(async version => versionDto(version, source, await repo.getManualVersionAction(source.id, item.id, version.id) ? item.canonicalUrl : undefined)))
  return { item: itemDto(item), source: sourceDto(source), manualActions, manualLabel, manualEntry: selectedManual ? { operator: selectedManual.operator, enteredAt: selectedManual.entered_at } : null, versions: page(versionRows, limit, offset), selectedVersion: selected ? { ...versionDto(selected, source, manualUrl), blocks: safeBlocks } : null }
}
