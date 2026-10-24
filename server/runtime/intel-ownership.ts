import process from "node:process"
import { randomUUID } from "node:crypto"
import { mkdir, open, readFile, realpath, unlink } from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"

/** Fail-closed file lease: no age/PID-based stale deletion. Held until Runtime drains. */
export async function acquireIntelDatabaseOwnership(databasePath: string) {
  const absolute = resolve(databasePath)
  await mkdir(dirname(absolute), { recursive: true })
  const parent = await realpath(dirname(absolute))
  let canonical = resolve(parent, basename(absolute))
  try {
    canonical = await realpath(absolute)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
  }
  const lock = `${canonical}.intel-owner.lock`
  const token = randomUUID()
  let handle
  try {
    handle = await open(lock, "wx", 0o600)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("intel_database_owner_busy")
    throw error
  }
  try {
    await handle.writeFile(JSON.stringify({ token, database: canonical, pid: process.pid }))
    await handle.sync()
  } catch (error) {
    await handle.close()
    await unlink(lock)
    throw error
  }
  let released = false
  return { async release() {
    if (released) return
    const value = JSON.parse(await readFile(lock, "utf8")) as { token?: string }
    if (value.token !== token) throw new Error("intel_database_owner_changed")
    await handle.close()
    await unlink(lock)
    released = true
  } }
}
