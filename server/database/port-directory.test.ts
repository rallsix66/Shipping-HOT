import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { describe, expect, it } from "vitest"
import { PortDirectoryRepository } from "./port-directory"
import { initShippingTables } from "./shipping"

function createNativeDatabase() {
  const native = new NativeDatabase(":memory:")
  const database = createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => native.exec(sql),
    prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: (string | number | boolean | null | undefined)[]) => statement.all(...params),
        get: async (...params: (string | number | boolean | null | undefined)[]) => statement.get(...params),
        run: async (...params: (string | number | boolean | null | undefined)[]) => {
          const result = statement.run(...params)
          return { success: result.changes > 0, changes: result.changes, lastInsertRowid: result.lastInsertRowid }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
  return { database, native }
}

describe("portDirectoryRepository", () => {
  it("searches the P1A baseline by UN/LOCODE, name and alias", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const repository = new PortDirectoryRepository(database, "real")

    await expect(repository.getPortByUNLocode("cnshk")).resolves.toMatchObject({
      unlocode: "CNSHK",
      nameEn: "Shekou",
      nameZh: "蛇口",
      countryCode: "CN",
      source: "unlocode",
      latitude: 22.48,
      longitude: 113.91,
      isActive: true,
    })
    await expect(repository.getPortCoordinate("CNSHK")).resolves.toEqual({ latitude: 22.48, longitude: 113.91 })
    await expect(repository.getPortAliases("CNSHK")).resolves.toEqual(["Shekou", "蛇口", "蛇口港", "CNSHK"])
    await expect(repository.searchPorts("蛇口")).resolves.toEqual([expect.objectContaining({ unlocode: "CNSHK" })])
    await expect(repository.searchPorts("MYPKG")).resolves.toEqual([expect.objectContaining({ nameEn: "Port Klang" })])
    native.close()
  })

  it("never exposes mock directory rows in Real Mode", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    await database.prepare(`
      INSERT INTO port_directory (unlocode, name_en, name_zh, country_code, latitude, longitude, timezone, aliases, source, verified_at, is_active)
      VALUES ('ZZMOCK', 'Mock Port', '模拟港', 'ZZ', 1, 2, 'UTC', ?, 'mock', NULL, 1)
    `).run(JSON.stringify(["Mock Port", "模拟港", "ZZMOCK"]))

    const realRepository = new PortDirectoryRepository(database, "real")
    const mockRepository = new PortDirectoryRepository(database, "mock")
    await expect(realRepository.getPortByUNLocode("ZZMOCK")).resolves.toBeUndefined()
    await expect(realRepository.searchPorts("ZZMOCK")).resolves.toEqual([])
    await expect(mockRepository.getPortByUNLocode("ZZMOCK")).resolves.toMatchObject({ source: "mock" })
    native.close()
  })

  it("resolves exact UN/LOCODE, name and alias identity and keeps unmapped identifiers raw", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    const repository = new PortDirectoryRepository(database, "real")

    await expect(repository.resolvePortIdentity("CNSHK")).resolves.toBe("CNSHK")
    await expect(repository.resolvePortIdentity("Shekou")).resolves.toBe("CNSHK")
    await expect(repository.resolvePortIdentity("蛇口港")).resolves.toBe("CNSHK")
    await expect(repository.resolvePortIdentity("丹戎不碌")).resolves.toBe("IDJKT")
    await expect(repository.resolvePortIdentity("MYPKG")).resolves.toBe("MYPKG")
    // Unmapped destinations must not be guessed onto an existing port.
    await expect(repository.resolvePortIdentity("CNYPG")).resolves.toBeUndefined()
    await expect(repository.resolvePortIdentity("")).resolves.toBeUndefined()
    native.close()
  })

  it("keeps an ambiguous alias unresolved instead of guessing the first match", async () => {
    const { database, native } = createNativeDatabase()
    await initShippingTables(database, "real")
    // A second active official port sharing the alias "Shekou" creates ambiguity.
    await database.prepare(`
      INSERT INTO port_directory (unlocode, name_en, name_zh, country_code, latitude, longitude, timezone, aliases, source, verified_at, is_active)
      VALUES ('ZZAMB', 'Shekou', '蛇口', 'ZZ', 3, 4, 'UTC', ?, 'official', NULL, 1)
    `).run(JSON.stringify(["Shekou", "蛇口", "ZZAMB"]))
    const repository = new PortDirectoryRepository(database, "real")

    await expect(repository.resolvePortIdentity("Shekou")).resolves.toBeUndefined()
    await expect(repository.resolvePortIdentity("蛇口")).resolves.toBeUndefined()
    // A value that is still unique keeps resolving.
    await expect(repository.resolvePortIdentity("CNSHK")).resolves.toBe("CNSHK")
    await expect(repository.resolvePortIdentity("MYPKG")).resolves.toBe("MYPKG")
    native.close()
  })
})
