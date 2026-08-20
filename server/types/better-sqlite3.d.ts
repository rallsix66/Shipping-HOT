declare module "better-sqlite3" {
  type Value = string | number | boolean | null | undefined

  interface Statement {
    all: (...params: Value[]) => unknown[]
    get: (...params: Value[]) => unknown
    run: (...params: Value[]) => { changes: number, lastInsertRowid: number | bigint }
  }

  class Database {
    constructor(path: string, options?: { readonly?: boolean })
    exec(sql: string): void
    prepare(sql: string): Statement
    close(): void
  }

  export default Database
}
