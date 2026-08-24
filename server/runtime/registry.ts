import type { RuntimeJob } from "#/runtime/background-runtime"

/**
 * P2C deliberately starts with no production business jobs. Later Provider
 * workstreams may add jobs here after their own contracts are approved.
 */
export function getDefaultRuntimeJobs(): RuntimeJob[] {
  return []
}
