import { randomUUID } from "node:crypto"
import { closeSync, fsyncSync, mkdirSync, openSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { IntelCollectOutcome } from "../../server/intel/collect"

type SourceId = "MY-P03" | "TH-C01"
type EvidenceKind = "synthetic_offline" | "held_live_response"
const SOURCE_IDS = new Set(["MY-P03", "TH-C01"])
const STATUSES = new Set(["ok_items", "ok_empty", "failed", "storage_unavailable", "skipped"])
const ERROR_CODES = new Set(["config_invalid", "parse_failed", "store_failed", "fetch_failed", "run_start_failed", "finalize_failed", "source_run_in_flight", "blocked_address", "body_too_large", "content_type_missing", "content_type_unsupported", "credentials_not_allowed", "dns_empty", "dns_failed", "fetch_timeout", "host_not_allowed", "http_error", "http_not_allowed", "https_downgrade", "invalid_redirect", "invalid_url", "protocol_not_allowed", "redirect_limit", "redirect_without_location", "source_ca_invalid"])
const IO_CODES = new Set(["EACCES", "EIO", "ENOSPC", "EPERM", "ENOENT", "EROFS", "EBUSY", "EEXIST", "ENOTDIR", "EISDIR", "ENOTEMPTY", "EINVAL", "EMFILE", "ENFILE"])

export interface ProbeProgress {
  first?: IntelCollectOutcome
  second?: IntelCollectOutcome
  count?: number
}
export interface ProbeTask {
  id: SourceId
  run: (progress: ProbeProgress, checkpoint: () => Promise<void>) => Promise<void>
  dispose?: () => void | Promise<void>
}
interface SafeOutcome {
  status: string
  errorCode?: string
  runId?: string | null
  itemsSeen?: number
  itemsNew?: number
  itemsRevised?: number
  itemsCommitted?: number
}
export interface ProbeRecord {
  id: SourceId
  evidenceKind: EvidenceKind
  status: "RUNNING" | "PASS" | "FAIL"
  first: SafeOutcome | null
  second: SafeOutcome | null
  count: number | null
  failure: "collector_failure" | "probe_incomplete" | "probe_exception" | "cleanup_exception" | null
  exceptionType: string | null
  persistenceErrors: { phase: "start" | "checkpoint" | "final", code: string }[]
  startedAt: string
  finishedAt: string | null
}
export interface ProbeReport {
  ok: boolean
  sources: ProbeRecord[]
  summaryPersistence: "SAVED" | "FAILED"
  summaryErrorCode: string | null
}
export interface ProbeSink {
  saveSource: (record: ProbeRecord) => void | Promise<void>
  saveSummary: (report: ProbeReport) => void | Promise<void>
}

const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 500 ? value : null
function safeOutcome(value: IntelCollectOutcome | undefined): SafeOutcome | null {
  if (!value) return null
  const safe: SafeOutcome = { status: STATUSES.has(value.status) ? value.status : "invalid_outcome" }
  if ("errorCode" in value) safe.errorCode = ERROR_CODES.has(value.errorCode) ? value.errorCode : "unrecognized_error_code"
  if ("runId" in value) safe.runId = value.runId === null || /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(value.runId) ? value.runId : null
  for (const key of ["itemsSeen", "itemsNew", "itemsRevised", "itemsCommitted"] as const) {
    if (key in value) {
      const number = count(value[key])
      if (number !== null) safe[key] = number
    }
  }
  return safe
}
function ioCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === "string" && IO_CODES.has(code) ? code : "write_failed"
}
function exceptionType(error: unknown): string {
  return error instanceof Error && ["Error", "AssertionError", "TypeError", "RangeError", "SyntaxError"].includes(error.name) ? error.name : "unknown_exception"
}

/** No fetch or assertions here: process every already-held response, saving each phase independently. */
export async function recordTwoIndexProbe(tasks: ProbeTask[], sink: ProbeSink, evidenceKind: EvidenceKind, now: () => Date = () => new Date()): Promise<ProbeReport> {
  if (!tasks.length || tasks.some(task => !SOURCE_IDS.has(task.id)) || new Set(tasks.map(task => task.id)).size !== tasks.length) throw new Error("invalid_probe_sources")
  const sources: ProbeRecord[] = []
  for (const task of tasks) {
    const progress: ProbeProgress = {}
    const record: ProbeRecord = { id: task.id, evidenceKind, status: "RUNNING", first: null, second: null, count: null, failure: null, exceptionType: null, persistenceErrors: [], startedAt: now().toISOString(), finishedAt: null }
    const refresh = () => {
      record.first = safeOutcome(progress.first)
      record.second = safeOutcome(progress.second)
      record.count = count(progress.count)
    }
    const save = async (phase: "start" | "checkpoint" | "final") => {
      refresh()
      try {
        // Only the explicitly selected fields enter the sink; raw exception messages/response bodies never do.
        await sink.saveSource(structuredClone(record))
      } catch (error) {
        record.persistenceErrors.push({ phase, code: ioCode(error) })
        record.status = "FAIL"
      }
    }
    await save("start")
    try {
      await task.run(progress, () => save("checkpoint"))
      const successful = (outcome: IntelCollectOutcome | undefined) => outcome?.status === "ok_items" || outcome?.status === "ok_empty"
      if (!successful(progress.first) || !successful(progress.second)) record.failure = progress.first && progress.second ? "collector_failure" : "probe_incomplete"
      else if (count(progress.count) === null) record.failure = "probe_incomplete"
    } catch (error) {
      record.failure = "probe_exception"
      record.exceptionType = exceptionType(error)
    } finally {
      try {
        await task.dispose?.()
      } catch (error) {
        record.failure ??= "cleanup_exception"
        record.exceptionType ??= exceptionType(error)
      }
      record.finishedAt = now().toISOString()
      record.status = record.failure || record.persistenceErrors.length ? "FAIL" : "PASS"
      await save("final")
      sources.push(structuredClone(record))
    }
  }
  const report: ProbeReport = { ok: sources.every(source => source.status === "PASS"), sources, summaryPersistence: "SAVED", summaryErrorCode: null }
  try {
    await sink.saveSummary(structuredClone(report))
  } catch (error) {
    report.ok = false
    report.summaryPersistence = "FAILED"
    report.summaryErrorCode = ioCode(error)
  }
  return report
}

/** Atomic complete-file writes; a failed pending file is preserved for recovery, never counted as saved. */
export function createProbeFileSink(directory: string): ProbeSink {
  const write = (name: string, data: unknown) => {
    mkdirSync(directory, { recursive: true })
    const target = join(directory, name)
    const pending = `${target}.${randomUUID()}.pending`
    const fd = openSync(pending, "wx")
    try {
      writeFileSync(fd, `${JSON.stringify(data, null, 2)}\n`, "utf8")
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    renameSync(pending, target)
  }
  return {
    saveSource: (record) => {
      if (!SOURCE_IDS.has(record.id)) throw new Error("invalid_probe_source")
      write(`${record.id}-outcome.json`, record)
    },
    saveSummary: report => write("summary.json", report),
  }
}
