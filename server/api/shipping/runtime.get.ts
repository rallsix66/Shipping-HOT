import { getBackgroundRuntime } from "#/runtime/bootstrap"

export default defineEventHandler(() => {
  const runtime = getBackgroundRuntime()
  return runtime?.getStatus() ?? { running: false, jobs: [] }
})
