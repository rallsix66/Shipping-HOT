import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { loadServerEnv } from "../scripts/load-env"

describe("server environment loading", () => {
  it("uses process values over local values over server values", () => {
    const rootDir = mkdtempSync(join(tmpdir(), "shipping-hot-env-"))
    try {
      writeFileSync(join(rootDir, ".env.local"), "SHIPPING_HOT_ENV_TEST=local\nLOCAL_ONLY=local\n")
      writeFileSync(join(rootDir, ".env.server"), "SHIPPING_HOT_ENV_TEST=server\nSERVER_ONLY=server\n")
      const processEnv: NodeJS.ProcessEnv = { SHIPPING_HOT_ENV_TEST: "process" }

      loadServerEnv({ rootDir, processEnv })

      expect(processEnv.SHIPPING_HOT_ENV_TEST).toBe("process")
      expect(processEnv.LOCAL_ONLY).toBe("local")
      expect(processEnv.SERVER_ONLY).toBe("server")
    } finally {
      rmSync(rootDir, { recursive: true, force: true })
    }
  })
})
