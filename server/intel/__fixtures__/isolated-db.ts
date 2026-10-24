// Test-only native SQLite adapter; callers choose :memory: or a new isolated .tmp path.
import NativeDatabase from "better-sqlite3"
import { createDatabase } from "db0"
import { IntelRepository } from "#/database/intel"

export function open(path = ":memory:", fault?: (sql: string) => void) {
  const native = new NativeDatabase(path)
  const database = createDatabase({
    name: "sqlite",
    dialect: "sqlite",
    getInstance: () => native,
    exec: (sql: string) => {
      fault?.(sql)
      return native.exec(sql)
    },
    prepare: (sql: string) => {
      const statement = native.prepare(sql)
      return {
        all: async (...params: (string | number | boolean | null | undefined)[]) => statement.all(...params),
        get: async (...params: (string | number | boolean | null | undefined)[]) => statement.get(...params),
        run: async (...params: (string | number | boolean | null | undefined)[]) => {
          fault?.(sql)
          const result = statement.run(...params)
          return { success: true, ...result }
        },
      }
    },
    dispose: () => native.close(),
  } as never)
  return { native, database, repository: new IntelRepository(database) }
}
