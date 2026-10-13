import { mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { expect, it, vi } from "vitest"
import type { IntelCollectOutcome } from "../../server/intel/collect"
import { type ProbeRecord, type ProbeReport, type ProbeSink, type ProbeTask, createProbeFileSink, recordTwoIndexProbe } from "./two-index-probe-results"

const success: Extract<IntelCollectOutcome, { status: "ok_items" | "ok_empty" }> = { status: "ok_items", runId: "11111111-1111-1111-1111-111111111111", itemsSeen: 2, itemsNew: 2, itemsRevised: 0 }
const failed: IntelCollectOutcome = { status: "failed", runId: "22222222-2222-2222-2222-222222222222", errorCode: "parse_failed", itemsCommitted: 0 }
const clock = () => new Date("2026-10-13T09:00:00Z")
function tasks(firstOutcome: IntelCollectOutcome = failed): ProbeTask[] {
  return ["MY-P03", "TH-C01"].map((id, index) => ({
    id: id as ProbeTask["id"],
    run: async (progress, checkpoint) => {
      progress.first = index ? success : firstOutcome
      await checkpoint()
      progress.second = index ? { ...success, itemsNew: 0 } : firstOutcome
      await checkpoint()
      progress.count = index ? 2 : firstOutcome.status === "failed" ? 0 : 2
      await checkpoint()
    },
    dispose: vi.fn(),
  }))
}
function memorySink() {
  const snapshots: ProbeRecord[] = []
  const summaries: ProbeReport[] = []
  const sink: ProbeSink = { saveSource: (record) => {
    snapshots.push(record)
  }, saveSummary: (report) => {
    summaries.push(report)
  } }
  return { sink, snapshots, summaries }
}

it("synthetic: persists Northport failure immediately and still processes Thai success before aggregating", async () => {
  const { sink, snapshots, summaries } = memorySink()
  const inputs = tasks()
  const report = await recordTwoIndexProbe(inputs, sink, "synthetic_offline", clock)
  expect(report.ok).toBe(false)
  expect(report.sources[0]).toMatchObject({ id: "MY-P03", status: "FAIL", first: failed, second: failed, count: 0, failure: "collector_failure" })
  expect(report.sources[1]).toMatchObject({ id: "TH-C01", status: "PASS", count: 2 })
  expect(snapshots.find(record => record.id === "MY-P03" && record.first && !record.second)?.first).toMatchObject(failed)
  const finalNorthport = snapshots.findIndex(record => record.id === "MY-P03" && record.finishedAt !== null)
  const startThai = snapshots.findIndex(record => record.id === "TH-C01")
  expect(finalNorthport).toBeLessThan(startThai)
  expect(inputs.every(task => vi.mocked(task.dispose!).mock.calls.length === 1)).toBe(true)
  expect(summaries).toHaveLength(1)
})

it("synthetic: an assertion after the second checkpoint keeps outcomes and continues the next source", async () => {
  const { sink, snapshots } = memorySink()
  const inputs = tasks()
  inputs[0].run = async (progress, checkpoint) => {
    progress.first = failed
    await checkpoint()
    progress.second = failed
    progress.count = 0
    await checkpoint()
    expect(progress.second.status).toBe("ok_items")
  }
  const report = await recordTwoIndexProbe(inputs, sink, "synthetic_offline", clock)
  expect(report.sources[0]).toMatchObject({ failure: "probe_exception", exceptionType: "AssertionError", first: failed, second: failed, count: 0 })
  expect(report.sources[1].status).toBe("PASS")
  expect(snapshots.filter(record => record.id === "MY-P03").at(-1)?.second?.errorCode).toBe("parse_failed")
})

it.each(["start", "checkpoint", "final"])("synthetic: %s save fault is sticky fail-closed and remaining sources continue", async (phase) => {
  const { sink, summaries } = memorySink()
  const save = sink.saveSource
  let sourceCalls = 0
  sink.saveSource = (record) => {
    if (record.id === "MY-P03") {
      const index = sourceCalls++
      if (index === ({ start: 0, checkpoint: 1, final: 4 }[phase])) throw Object.assign(new Error("SYNTHETIC private exception text"), { code: "EIO" })
    }
    return save(record)
  }
  const report = await recordTwoIndexProbe(tasks(success), sink, "synthetic_offline", clock)
  expect(report.ok).toBe(false)
  expect(report.sources[0]).toMatchObject({ status: "FAIL", count: 2, persistenceErrors: [{ phase, code: "EIO" }] })
  expect(report.sources[1].status).toBe("PASS")
  expect(summaries[0].sources[0].persistenceErrors).toHaveLength(1)
})

it("synthetic: summary save fault reports failure even after both per-source files succeeded", async () => {
  const { sink, snapshots } = memorySink()
  sink.saveSummary = () => {
    throw Object.assign(new Error("SYNTHETIC private text"), { code: "ENOSPC" })
  }
  const report = await recordTwoIndexProbe(tasks(success), sink, "synthetic_offline", clock)
  expect(report).toMatchObject({ ok: false, summaryPersistence: "FAILED", summaryErrorCode: "ENOSPC" })
  expect(snapshots.filter(record => record.status === "PASS")).toHaveLength(2)
})

it("synthetic: cleanup failure preserves outcomes and never prevents processing the second source", async () => {
  const { sink } = memorySink()
  const inputs = tasks(success)
  inputs[0].dispose = () => {
    throw new Error("SYNTHETIC private cleanup detail")
  }
  const report = await recordTwoIndexProbe(inputs, sink, "synthetic_offline", clock)
  expect(report.sources[0]).toMatchObject({ status: "FAIL", failure: "cleanup_exception", count: 2, first: success })
  expect(report.sources[1].status).toBe("PASS")
})

it("synthetic: whitelists output fields and never persists raw exception/body/storage-error text", async () => {
  const { sink, snapshots, summaries } = memorySink()
  const inputs = tasks()
  inputs[0].run = async (progress, checkpoint) => {
    progress.first = { status: "storage_unavailable", runId: null, errorCode: "store_failed", storageError: "SYNTHETIC_PRIVATE_VALUE" }
    Object.assign(progress, { responseBody: "SYNTHETIC_PRIVATE_VALUE" })
    await checkpoint()
    throw new Error("SYNTHETIC_PRIVATE_VALUE")
  }
  await recordTwoIndexProbe(inputs, sink, "synthetic_offline", clock)
  expect(JSON.stringify({ snapshots, summaries })).not.toContain("SYNTHETIC_PRIVATE_VALUE")
  expect(summaries[0].sources[0].first?.errorCode).toBe("store_failed")
})

it("synthetic: unfinished outcomes or invalid counts cannot be successful", async () => {
  for (const missingCount of [true, false]) {
    const { sink } = memorySink()
    const input: ProbeTask = { id: "MY-P03", run: async (progress) => {
      progress.first = success
      progress.second = success
      if (!missingCount) progress.count = Number.NaN
    } }
    expect((await recordTwoIndexProbe([input], sink, "synthetic_offline", clock)).sources[0]).toMatchObject({ status: "FAIL", failure: "probe_incomplete", count: null })
  }
})

it("synthetic: explicit empty outcomes with a stored count of zero remain complete", async () => {
  const { sink } = memorySink()
  const empty: IntelCollectOutcome = { status: "ok_empty", runId: success.runId, itemsSeen: 0, itemsNew: 0, itemsRevised: 0 }
  const report = await recordTwoIndexProbe([{ id: "MY-P03", run: async (progress, checkpoint) => {
    progress.first = empty
    await checkpoint()
    progress.second = empty
    progress.count = 0
    await checkpoint()
  } }], sink, "synthetic_offline", clock)
  expect(report).toMatchObject({ ok: true, sources: [{ status: "PASS", count: 0 }] })
})

it("synthetic: rejects duplicate/out-of-scope IDs before running or writing", async () => {
  const { sink, snapshots } = memorySink()
  const input = tasks(success)[0]
  await expect(recordTwoIndexProbe([input, input], sink, "synthetic_offline", clock)).rejects.toThrow("invalid_probe_sources")
  await expect(recordTwoIndexProbe([{ ...input, id: "../invalid" } as unknown as ProbeTask], sink, "synthetic_offline", clock)).rejects.toThrow("invalid_probe_sources")
  expect(snapshots).toHaveLength(0)
  await expect(recordTwoIndexProbe([], sink, "synthetic_offline", clock)).rejects.toThrow("invalid_probe_sources")
})

it("synthetic: a real rename failure preserves pending files, reports failure and continues Thai", async () => {
  mkdirSync(".tmp", { recursive: true })
  const directory = mkdtempSync(join(".tmp", "two-probe-write-failure-"))
  mkdirSync(join(directory, "MY-P03-outcome.json"))
  const report = await recordTwoIndexProbe(tasks(success), createProbeFileSink(directory), "synthetic_offline", clock)
  expect(report.ok).toBe(false)
  expect(report.sources[0].persistenceErrors.length).toBeGreaterThan(0)
  expect(report.sources[0].persistenceErrors.every(error => error.code !== "write_failed")).toBe(true)
  expect(report.sources[1].status).toBe("PASS")
  expect(readdirSync(directory).some(name => name.endsWith(".pending"))).toBe(true)
  expect(JSON.parse(readFileSync(join(directory, "summary.json"), "utf8"))).toMatchObject({ ok: false })
})

it("writes complete atomic source files and summary to an isolated directory", async () => {
  mkdirSync(".tmp", { recursive: true })
  const directory = mkdtempSync(join(".tmp", "two-probe-outcomes-"))
  const report = await recordTwoIndexProbe(tasks(), createProbeFileSink(directory), "synthetic_offline", clock)
  expect(JSON.parse(readFileSync(join(directory, "MY-P03-outcome.json"), "utf8"))).toMatchObject(report.sources[0])
  expect(JSON.parse(readFileSync(join(directory, "TH-C01-outcome.json"), "utf8"))).toMatchObject(report.sources[1])
  expect(JSON.parse(readFileSync(join(directory, "summary.json"), "utf8"))).toMatchObject(report)
  expect(readdirSync(directory).some(name => name.endsWith(".pending"))).toBe(false)
})
