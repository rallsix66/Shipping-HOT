type WorkerProcess = Pick<NodeJS.EventEmitter, "on" | "removeListener"> & { connected?: boolean, send?: unknown }
export interface WorkerStopLatch {
  signal: AbortSignal
  expectsIpc: boolean
  recheck: () => void
  dispose: () => void
}

/**
 * Installed synchronously before the first asynchronous business import, so a parent disconnect, a stop
 * message or SIGINT/SIGTERM during the import barrier is latched rather than missed. When the worker was
 * spawned with an IPC channel, `connected` is checked immediately and re-checked after the barrier.
 */
export function latchWorkerStop(proc: WorkerProcess): WorkerStopLatch {
  const stop = new AbortController()
  const abort = () => stop.abort()
  const onMessage = (message: unknown) => {
    if (message && typeof message === "object" && Object.keys(message).join(",") === "type" && (message as { type: unknown }).type === "stop") abort()
  }
  const expectsIpc = typeof proc.send === "function"
  const recheck = () => {
    if (expectsIpc && proc.connected !== true) abort()
  }
  proc.on("message", onMessage)
  proc.on("disconnect", abort)
  proc.on("SIGINT", abort)
  proc.on("SIGTERM", abort)
  recheck()
  return { signal: stop.signal, expectsIpc, recheck, dispose() {
    proc.removeListener("message", onMessage)
    proc.removeListener("disconnect", abort)
    proc.removeListener("SIGINT", abort)
    proc.removeListener("SIGTERM", abort)
  } }
}

/** Business imports run behind the barrier; the channel is re-checked and the (possibly already aborted) signal is threaded into start. */
export async function startAfterImportBarrier<M, R>(latch: WorkerStopLatch, importBusiness: () => Promise<M>, start: (modules: M, signal: AbortSignal) => Promise<R>): Promise<R> {
  const modules = await importBusiness()
  latch.recheck()
  return start(modules, latch.signal)
}
