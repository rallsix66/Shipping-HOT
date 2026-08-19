import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { loadServerEnv } from "../scripts/load-env"

describe("server environment loading", () => {
  function withEnvFiles(localContent: string, serverContent: string, callback: (rootDir: string) => void) {
    const rootDir = mkdtempSync(join(tmpdir(), "shipping-hot-env-"))
    try {
      writeFileSync(join(rootDir, ".env.local"), localContent)
      writeFileSync(join(rootDir, ".env.server"), serverContent)
      callback(rootDir)
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  }

  it("preserves explicit process environment over local and server values", () => {
    withEnvFiles("SHIPPING_HOT_ENV_PRIORITY=local\n", "SHIPPING_HOT_ENV_PRIORITY=server\n", (rootDir) => {
      const processEnv: NodeJS.ProcessEnv = { SHIPPING_HOT_ENV_PRIORITY: "process" }
      loadServerEnv({ rootDir, processEnv })
      expect(processEnv.SHIPPING_HOT_ENV_PRIORITY).toBe("process")
    })
  })

  it("prefers local values over server values", () => {
    withEnvFiles("SHIPPING_HOT_ENV_LOCAL_OVER_SERVER=local\n", "SHIPPING_HOT_ENV_LOCAL_OVER_SERVER=server\n", (rootDir) => {
      const processEnv: NodeJS.ProcessEnv = {}
      loadServerEnv({ rootDir, processEnv })
      expect(processEnv.SHIPPING_HOT_ENV_LOCAL_OVER_SERVER).toBe("local")
    })
  })

  it("fills missing values from the server file", () => {
    withEnvFiles("LOCAL_ONLY=local\n", "SHIPPING_HOT_ENV_SERVER_ONLY=server\n", (rootDir) => {
      const processEnv: NodeJS.ProcessEnv = {}
      loadServerEnv({ rootDir, processEnv })
      expect(processEnv.SHIPPING_HOT_ENV_SERVER_ONLY).toBe("server")
    })
  })
})
