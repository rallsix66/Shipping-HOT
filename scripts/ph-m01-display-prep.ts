import { type ChildProcess, spawn } from "node:child_process"
import { Buffer } from "node:buffer"
import { createHash, randomBytes, timingSafeEqual } from "node:crypto"
import { createReadStream, existsSync, lstatSync, mkdirSync, realpathSync, statSync } from "node:fs"
import { connect as connectNet, createServer } from "node:net"
import { dirname, isAbsolute, join, relative, resolve } from "node:path"
import process from "node:process"
import { finished } from "node:stream/promises"
import NativeDatabase from "better-sqlite3"

export const DISPLAY_GUARD_RELATIVE = join("scripts", "lib", "ph-m01-display-guard.cjs")
export const DISPLAY_SERVER_RELATIVE = join("dist", "output", "server", "index.mjs")
export const DISPLAY_DB_RELATIVE = join(".data", "shipping-hot-v3.sqlite3")

const PROTECTED_PREFIXES = [
  join(".tmp", "ph-m01-oneshot-phm01live20261024a"),
  join(".tmp", "ph-m01-live-logs-phm01live20261024a"),
  join(".tmp", "deepseek-pilot-2026-10-23"),
  join(".tmp", "deepseek-search-fetch-gapfix3-2026-10-23"),
  ".data",
]

const RESERVED_DIR_NAMES = new Set([
  "ph-m01-oneshot-phm01live20261024a",
  "ph-m01-live-logs-phm01live20261024a",
  "deepseek-pilot-2026-10-23",
  "deepseek-search-fetch-gapfix3-2026-10-23",
  "s7-local",
  "s5-browser",
])

const SECRET_ENV_KEYS = [
  "GFW_API_TOKEN",
  "VESSELAPI_API_KEY",
  "AISSTREAM_API_KEY",
  "CALENDARIFIC_API_KEY",
  "DEEPSEEK_API_KEY",
  "QWEN_MT_API_KEY",
  "GEMINI_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "DEEPL_API_KEY",
  "AZURE_TRANSLATOR_API_KEY",
]

const PROXY_ENV_KEYS = ["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "http_proxy", "https_proxy", "all_proxy", "no_proxy", "NODE_OPTIONS"]

const INIT_APP_METADATA_FIELDS = new Set(["last_migration_at", "data_mode", "schema_version"])
const INSERT_ONLY_TABLES = new Set(["settings", "port_directory_status"])
const COUNTER_TABLES = ["intel_item", "intel_item_version", "intel_item_block", "intel_fetch_run", "provider_usage", "provider_runtime"] as const

export class DisplayPrepError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "DisplayPrepError"
  }
}

export interface SourceProof {
  path: string
  realPath: string
  dev: number
  ino: number
  size: number
  sha256: string
  wal: boolean
  shm: boolean
}

export interface DisplayRow {
  [key: string]: string | number | null
}

export interface DisplaySnapshot {
  journalMode: string
  dataVersion: number
  counts: Record<(typeof COUNTER_TABLES)[number], number | null>
  items: DisplayRow[]
  digests: Record<string, string>
  tables: Record<string, DisplayRow[]>
}

export interface SnapshotDiff {
  ok: boolean
  mode: "init" | "read"
  allowed: string[]
  unexpected: string[]
}

export interface TrackedProcess {
  child: ChildProcess
  pid: number
  entry: string
  cwd: string
  args: string[]
  startedAt: string
  shutdownPort: number
  shutdownToken: string
  appPort: number | null
  stdout: string
  stderr: string
}

export interface StartResult {
  ok: boolean
  reason: "ready" | "startup_exit" | "startup_timeout" | "missing_pid"
  identity: TrackedProcess
  exitCode: number | null
  signalCode: NodeJS.Signals | null
}

export interface StopResult {
  confirmed: boolean
  graceful: boolean
  alreadyExited: boolean
  exited: boolean
  exitCode: number | null
  signalCode: NodeJS.Signals | null
  appPortFree: boolean | null
  shutdownPortFree: boolean
  reason: string
}

export interface DisplayLaunchPlan {
  browserRequestBlock: "not_ready"
  browserRequestBlockReason: string
  command: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  allow: []
  serverCoverage: string
  initBaseline: string
  readWindow: string
  stop: string
}

interface UserTable {
  name: string
}

function fail(code: string, detail = ""): never {
  throw new DisplayPrepError(detail ? `${code}: ${detail}` : code)
}

function realPathOf(path: string): string {
  return realpathSync.native ? realpathSync.native(path) : realpathSync(path)
}

function inside(parent: string, candidate: string): boolean {
  const fromParent = relative(parent, candidate)
  return fromParent === "" || (!fromParent.startsWith("..") && !isAbsolute(fromParent))
}

function isProtected(repoRoot: string, candidate: string): boolean {
  const realCandidate = existsSync(candidate) ? realPathOf(candidate) : resolve(candidate)
  return PROTECTED_PREFIXES.some((prefix) => {
    const root = resolve(repoRoot, prefix)
    const realRoot = existsSync(root) ? realPathOf(root) : root
    return inside(realRoot, realCandidate) || inside(root, resolve(candidate))
  })
}

export async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256")
  const stream = createReadStream(path)
  stream.on("data", chunk => hash.update(chunk))
  await finished(stream)
  return hash.digest("hex")
}

function sidecars(path: string): { wal: boolean, shm: boolean } {
  return { wal: existsSync(`${path}-wal`), shm: existsSync(`${path}-shm`) }
}

export async function readSourceProof(path: string): Promise<SourceProof> {
  let link: ReturnType<typeof lstatSync>
  try {
    link = lstatSync(path)
  } catch (error) {
    fail("source_unreadable", error instanceof Error ? error.message : String(error))
  }
  if (link.isSymbolicLink()) fail("source_symlink", path)
  if (!link.isFile()) fail("source_not_file", path)
  const side = sidecars(path)
  if (side.wal || side.shm) fail("sqlite_sidecar_present", `${path} wal=${side.wal} shm=${side.shm}`)
  const realPath = realPathOf(path)
  if (realPath !== resolve(path)) fail("source_realpath_differs", realPath)
  const file = statSync(realPath)
  return {
    path: resolve(path),
    realPath,
    dev: file.dev,
    ino: file.ino,
    size: file.size,
    sha256: await sha256File(realPath),
    wal: false,
    shm: false,
  }
}

export function assertSourceProofUnchanged(before: SourceProof, after: SourceProof): void {
  if (after.wal || after.shm) fail("sqlite_sidecar_present", after.path)
  if (before.dev !== after.dev || before.ino !== after.ino || before.realPath !== after.realPath) fail("source_identity_changed", after.realPath)
  if (before.sha256 !== after.sha256) fail("source_changed_during_copy", `${before.sha256} -> ${after.sha256}`)
}

function assertFreshDisplayDir(repoRoot: string, displayDir: string): string {
  const tmpRoot = resolve(repoRoot, ".tmp")
  if (!existsSync(tmpRoot)) fail("display_tmp_missing", tmpRoot)
  const resolved = resolve(displayDir)
  const parent = dirname(resolved)
  if (!existsSync(parent)) fail("display_parent_missing", parent)
  let parentReal: string
  let tmpReal: string
  try {
    parentReal = realPathOf(parent)
    tmpReal = realPathOf(tmpRoot)
  } catch (error) {
    fail("display_dir_escapes_tmp", error instanceof Error ? error.message : String(error))
  }
  const leaf = resolved.slice(parent.length + 1)
  if (!leaf || leaf === "." || leaf === "..") fail("display_dir_invalid", resolved)
  const realDisplay = join(parentReal, leaf)
  if (!inside(tmpReal, realDisplay)) fail("display_dir_escapes_tmp", realDisplay)
  if (RESERVED_DIR_NAMES.has(leaf) || isProtected(repoRoot, realDisplay)) fail("display_dir_reserved", realDisplay)
  if (existsSync(resolved)) fail("display_dir_exists", resolved)
  return realDisplay
}

export async function copyDisplayDatabase(options: {
  repoRoot: string
  sourcePath: string
  displayDir: string
  confirmProtectedSource?: boolean
}): Promise<{ source: SourceProof, copyPath: string, copySnapshot: DisplaySnapshot }> {
  const repoRoot = resolve(options.repoRoot)
  if (!options.confirmProtectedSource && isProtected(repoRoot, options.sourcePath)) fail("protected_source", options.sourcePath)
  const before = await readSourceProof(options.sourcePath)
  const displayReal = assertFreshDisplayDir(repoRoot, options.displayDir)
  const copyPath = join(displayReal, DISPLAY_DB_RELATIVE)
  mkdirSync(displayReal)
  mkdirSync(dirname(copyPath))
  const source = new NativeDatabase(before.realPath, { readonly: true, fileMustExist: true } as unknown as ConstructorParameters<typeof NativeDatabase>[1])
  try {
    await (source as unknown as { backup: (filename: string) => Promise<void> }).backup(copyPath)
  } finally {
    source.close()
  }
  const after = await readSourceProof(before.path)
  assertSourceProofUnchanged(before, after)
  return { source: after, copyPath, copySnapshot: readDisplaySnapshot(copyPath) }
}

function quoteIdent(name: string): string {
  if (!/^[A-Z_]\w*$/i.test(name)) fail("unexpected_table_name", name)
  return `"${name}"`
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => stable(item)).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`
  }
  return JSON.stringify(value)
}

function digestRows(rows: DisplayRow[]): string {
  return createHash("sha256").update(stable(rows)).digest("hex")
}

function tableNames(db: InstanceType<typeof NativeDatabase>): string[] {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as UserTable[]
  return rows.map(row => row.name)
}

function readRows(db: InstanceType<typeof NativeDatabase>, table: string): DisplayRow[] {
  return db.prepare(`SELECT * FROM ${quoteIdent(table)} ORDER BY rowid`).all() as DisplayRow[]
}

export function readDisplaySnapshot(dbPath: string): DisplaySnapshot {
  const side = sidecars(dbPath)
  if (side.wal || side.shm) fail("sqlite_sidecar_present", dbPath)
  const db = new NativeDatabase(dbPath, { readonly: true, fileMustExist: true } as unknown as ConstructorParameters<typeof NativeDatabase>[1])
  let snapshot: DisplaySnapshot
  try {
    const journal = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string }
    const version = db.prepare("PRAGMA data_version").get() as { data_version: number }
    const names = tableNames(db)
    const present = new Set(names)
    const tables: Record<string, DisplayRow[]> = {}
    const digests: Record<string, string> = {}
    for (const name of names) {
      tables[name] = readRows(db, name)
      digests[name] = digestRows(tables[name])
    }
    const counts = Object.fromEntries(COUNTER_TABLES.map(name => [name, present.has(name) ? tables[name].length : null])) as DisplaySnapshot["counts"]
    const items = present.has("intel_item") && present.has("intel_item_version") && present.has("intel_item_block")
      ? db.prepare(`
        SELECT
          i.id AS item_id, i.source_id, i.canonical_url, i.title, i.published_at, i.first_seen_at, i.last_seen_at, i.current_version_id,
          v.id AS version_id, v.content_hash, v.fetched_at, v.extractor_version, v.content_scope, v.source_published_at, v.source_updated_at, v.created_at,
          b.id AS block_id, b.block_key, b.block_order, b.block_type, b.text
        FROM intel_item i
        LEFT JOIN intel_item_version v ON v.item_id = i.id
        LEFT JOIN intel_item_block b ON b.version_id = v.id
        ORDER BY i.id, v.id, b.block_order, b.id
      `).all() as DisplayRow[]
      : []
    snapshot = { journalMode: journal.journal_mode, dataVersion: Number(version.data_version), counts, items, digests, tables }
  } finally {
    db.close()
  }
  const after = sidecars(dbPath)
  if (after.wal || after.shm) fail("sqlite_sidecar_present", dbPath)
  return snapshot
}

export function assertDisplayCounters(snapshot: DisplaySnapshot, expected: Partial<DisplaySnapshot["counts"]>): void {
  for (const [key, value] of Object.entries(expected)) {
    const actual = snapshot.counts[key as keyof DisplaySnapshot["counts"]]
    if (actual !== value) fail("display_counter_mismatch", `${key} expected ${value} actual ${actual}`)
  }
}

function diffRecords(label: string, before: DisplayRow[], after: DisplayRow[], allowedFields?: Set<string>): { allowed: string[], unexpected: string[] } {
  const allowed: string[] = []
  const unexpected: string[] = []
  if (before.length !== after.length && !allowedFields) {
    unexpected.push(`${label} count ${before.length} -> ${after.length}`)
  }
  const width = Math.max(before.length, after.length)
  for (let index = 0; index < width; index += 1) {
    const left = before[index]
    const right = after[index]
    if (!left || !right) {
      if (allowedFields && !left && right) allowed.push(`${label} insert row ${index + 1}`)
      else unexpected.push(`${label} row ${index + 1} ${left ? "removed" : "added"}`)
      continue
    }
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort()
    for (const key of keys) {
      if (stable(left[key]) === stable(right[key])) continue
      const name = `${label}.${key}[${index}]`
      if (key === "bootstrap_completed_at" && (left[key] == null || left[key] === "") && right[key] != null) allowed.push(name)
      else if (allowedFields?.has(key)) allowed.push(name)
      else unexpected.push(`${name} ${stable(left[key])} -> ${stable(right[key])}`)
    }
  }
  return { allowed, unexpected }
}

export function compareSnapshots(before: DisplaySnapshot, after: DisplaySnapshot, mode: "init" | "read"): SnapshotDiff {
  const allowed: string[] = []
  const unexpected: string[] = []
  if (before.journalMode !== after.journalMode || after.journalMode === "wal") unexpected.push(`journal_mode ${before.journalMode} -> ${after.journalMode}`)
  if (before.dataVersion !== after.dataVersion) {
    const change = `data_version ${before.dataVersion} -> ${after.dataVersion}`
    if (mode === "init") allowed.push(change)
    else unexpected.push(change)
  }
  const names = [...new Set([...Object.keys(before.digests), ...Object.keys(after.digests)])].sort()
  for (const name of names) {
    if (name === "app_metadata") {
      const diff = diffRecords(name, before.tables[name] ?? [], after.tables[name] ?? [], mode === "init" ? INIT_APP_METADATA_FIELDS : undefined)
      allowed.push(...diff.allowed)
      unexpected.push(...diff.unexpected)
      continue
    }
    if (INSERT_ONLY_TABLES.has(name) && mode === "init") {
      const left = before.tables[name] ?? []
      const right = after.tables[name] ?? []
      if (left.length === 0 && right.length > 0) allowed.push(`${name} insert ${right.length}`)
      else if (before.digests[name] !== after.digests[name]) unexpected.push(`${name} changed after it already existed`)
      continue
    }
    if (name === "schema_migrations" && mode === "init") {
      const left = before.tables[name] ?? []
      const right = after.tables[name] ?? []
      const leftByVersion = new Map(left.map(row => [String(row.version), stable(row)]))
      for (const row of right) {
        const version = String(row.version)
        const previous = leftByVersion.get(version)
        if (!previous) allowed.push(`schema_migrations +${version}`)
        else if (previous !== stable(row)) unexpected.push(`schema_migrations version ${version} modified`)
        leftByVersion.delete(version)
      }
      for (const version of leftByVersion.keys()) unexpected.push(`schema_migrations version ${version} removed`)
      continue
    }
    if ((before.digests[name] ?? "") !== (after.digests[name] ?? "")) unexpected.push(`table ${name}`)
  }
  const items = diffRecords("intel", before.items, after.items)
  unexpected.push(...items.unexpected)
  return { ok: unexpected.length === 0, mode, allowed, unexpected }
}

export function buildDisplayLaunchPlan(options: {
  repoRoot: string
  displayDir: string
  port: number
  shutdownPort: number
  token: string
  baseEnv?: NodeJS.ProcessEnv
}): DisplayLaunchPlan {
  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) fail("display_port_invalid")
  if (!Number.isInteger(options.shutdownPort) || options.shutdownPort < 1 || options.shutdownPort > 65535) fail("shutdown_port_invalid")
  if (options.port === options.shutdownPort) fail("shutdown_port_collides_with_display")
  if (!/^[0-9a-f]{32}$/.test(options.token)) fail("shutdown_token_invalid")
  const repoRoot = resolve(options.repoRoot)
  const entry = join(repoRoot, DISPLAY_SERVER_RELATIVE)
  const guard = join(repoRoot, DISPLAY_GUARD_RELATIVE)
  const cwd = resolve(options.displayDir)
  const env: NodeJS.ProcessEnv = { ...(options.baseEnv ?? {}) }
  for (const key of [...SECRET_ENV_KEYS, ...PROXY_ENV_KEYS, "NITRO_UNIX_SOCKET", "SHIPPING_INTEL_SOURCE_IDS"]) delete env[key]
  env.HOST = "127.0.0.1"
  env.NITRO_HOST = "127.0.0.1"
  env.PORT = String(options.port)
  env.NITRO_PORT = String(options.port)
  env.SHIPPING_DATA_MODE = "real"
  env.SHIPPING_RUNTIME_ENABLED = "false"
  env.SHIPPING_INTEL_ENABLED = "false"
  env.PH_M01_DISPLAY_GUARD = "1"
  env.PH_M01_DISPLAY_ALLOW = ""
  env.PH_M01_DISPLAY_SHUTDOWN_PORT = String(options.shutdownPort)
  env.PH_M01_DISPLAY_SHUTDOWN_TOKEN = options.token
  return {
    browserRequestBlock: "not_ready",
    browserRequestBlockReason: "The supported browser tool exposes no verified pre-request block. Page-script wrapping does not cover navigation, redirects, or parser subresources, and this slice must not open a CDP session to discover one.",
    command: [process.execPath, "--require", guard, entry],
    cwd,
    env,
    allow: [],
    serverCoverage: "JavaScript hooks inside the display Node process, installed before the server entry, deny DNS, TCP, TLS, HTTP(S), HTTP/2, fetch, UDP send, and child processes unless an exact 127.0.0.1:port is listed. This launch lists none. Native addon syscalls and later replacement of those hooks are outside the hook.",
    initBaseline: "Capture the copy after Nitro startup and one GET /api/shipping. Those two calls may rewrite app_metadata.last_migration_at, data_mode, schema_version, and a previously null bootstrap_completed_at; they may insert a missing settings or port_directory_status row and append unseen schema_migrations versions. Intel rows, provider_usage, and provider_runtime are not in that set.",
    readWindow: "Compare later /feed reads with compareSnapshots(mode=read), including titles, canonical URLs, dates, versions, block text, every user-table digest, and data_version. A new process is a new init window.",
    stop: "Connect to 127.0.0.1 on the shutdown port and emit SIGTERM inside the child so Nitro's existing listener can close. Do not child.kill or taskkill. Confirm the child exit code and both ports separately.",
  }
}

function bindLoopback(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        reject(new DisplayPrepError("loopback_port_unavailable"))
        return
      }
      server.close(() => resolvePort(address.port))
    })
  })
}

export async function reserveLoopbackPort(): Promise<number> {
  return bindLoopback()
}

export function createShutdownToken(): string {
  return randomBytes(16).toString("hex")
}

function collect(child: ChildProcess): { stdout: string, stderr: string } {
  const output = { stdout: "", stderr: "" }
  child.stdout?.on("data", (chunk: Buffer) => {
    output.stdout += chunk.toString("utf8")
  })
  child.stderr?.on("data", (chunk: Buffer) => {
    output.stderr += chunk.toString("utf8")
  })
  return output
}

export async function startTrackedProcess(options: {
  repoRoot: string
  entry: string
  cwd: string
  env: NodeJS.ProcessEnv
  ready: RegExp
  timeoutMs: number
  args?: string[]
}): Promise<StartResult> {
  const startedAt = new Date().toISOString()
  const guard = join(resolve(options.repoRoot), DISPLAY_GUARD_RELATIVE)
  const args = ["--require", guard, ...(options.args ?? []), options.entry]
  const child = spawn(process.execPath, args, {
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  })
  const output = collect(child)
  const identity: TrackedProcess = {
    child,
    pid: child.pid ?? 0,
    entry: options.entry,
    cwd: options.cwd,
    args,
    startedAt,
    shutdownPort: Number(options.env.PH_M01_DISPLAY_SHUTDOWN_PORT),
    shutdownToken: String(options.env.PH_M01_DISPLAY_SHUTDOWN_TOKEN ?? ""),
    appPort: null,
    stdout: "",
    stderr: "",
  }
  if (!identity.pid) return { ok: false, reason: "missing_pid", identity, exitCode: null, signalCode: null }
  const ready = await new Promise<{ ok: boolean, reason: StartResult["reason"], exitCode: number | null, signalCode: NodeJS.Signals | null }>((resolveReady) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (result: { ok: boolean, reason: StartResult["reason"], exitCode: number | null, signalCode: NodeJS.Signals | null }) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      child.removeAllListeners("exit")
      child.stdout?.removeAllListeners("data")
      resolveReady(result)
    }
    timer = setTimeout(() => finish({ ok: false, reason: "startup_timeout", exitCode: child.exitCode, signalCode: child.signalCode }), options.timeoutMs)
    child.once("exit", (code, signal) => finish({ ok: false, reason: "startup_exit", exitCode: code, signalCode: signal }))
    const watch = () => {
      identity.stdout = output.stdout
      identity.stderr = output.stderr
      const match = options.ready.exec(output.stdout)
      if (!match) return
      identity.appPort = Number(match[1])
      finish({ ok: true, reason: "ready", exitCode: null, signalCode: null })
    }
    child.stdout?.on("data", watch)
    watch()
  })
  identity.stdout = output.stdout
  identity.stderr = output.stderr
  return { ok: ready.ok, reason: ready.reason, identity, exitCode: ready.exitCode, signalCode: ready.signalCode }
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolveFree) => {
    const socket = connectNet({ host: "127.0.0.1", port })
    const timer = setTimeout(() => {
      socket.destroy()
      resolveFree(false)
    }, 300)
    socket.once("connect", () => {
      clearTimeout(timer)
      socket.destroy()
      resolveFree(false)
    })
    socket.once("error", (error: NodeJS.ErrnoException) => {
      clearTimeout(timer)
      resolveFree(error.code === "ECONNREFUSED")
    })
  })
}

async function sendStop(identity: TrackedProcess): Promise<void> {
  await new Promise<void>((resolveStop, reject) => {
    const socket = connectNet({ host: "127.0.0.1", port: identity.shutdownPort })
    let sent = false
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (error && !sent) reject(error)
      else resolveStop()
    }
    timer = setTimeout(() => {
      socket.destroy()
      finish(new DisplayPrepError("stop_channel_timeout"))
    }, 1000)
    socket.once("error", error => finish(error))
    socket.once("connect", () => {
      const token = Buffer.from(identity.shutdownToken)
      if (token.length !== 32 || !timingSafeEqual(token, Buffer.from(identity.shutdownToken))) {
        socket.destroy()
        finish(new DisplayPrepError("shutdown_token_invalid"))
        return
      }
      sent = true
      socket.end(`${identity.shutdownToken}\n`)
    })
    socket.once("close", () => finish())
  })
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode) return true
  return new Promise((resolveExit) => {
    const timer = setTimeout(() => resolveExit(false), timeoutMs)
    child.once("exit", () => {
      clearTimeout(timer)
      resolveExit(true)
    })
  })
}

export async function stopTrackedProcess(identity: TrackedProcess, timeoutMs: number): Promise<StopResult> {
  const alreadyExited = identity.child.exitCode !== null || Boolean(identity.child.signalCode)
  let channelOk = alreadyExited
  let channelError = ""
  if (!alreadyExited) {
    try {
      await sendStop(identity)
      channelOk = true
    } catch (error) {
      channelOk = false
      channelError = error instanceof Error ? error.message : String(error)
    }
    await waitForExit(identity.child, timeoutMs)
  }
  const exited = identity.child.exitCode !== null || Boolean(identity.child.signalCode)
  const appPortFree = identity.appPort == null ? null : await portFree(identity.appPort)
  const shutdownPortFree = await portFree(identity.shutdownPort)
  const cleanExit = exited && identity.child.exitCode === 0 && !identity.child.signalCode
  const portsFree = shutdownPortFree && appPortFree !== false
  const graceful = !alreadyExited && channelOk && cleanExit && portsFree
  const confirmed = cleanExit && portsFree
  let reason = "confirmed"
  if (!exited) reason = channelError ? `process_still_alive:${channelError}` : "process_still_alive"
  else if (!cleanExit) reason = identity.child.signalCode ? `terminated_by_signal:${identity.child.signalCode}` : `exit_${identity.child.exitCode}`
  else if (!portsFree) reason = "port_still_bound"
  else if (alreadyExited) reason = "already_exited"
  return {
    confirmed,
    graceful,
    alreadyExited,
    exited,
    exitCode: identity.child.exitCode,
    signalCode: identity.child.signalCode,
    appPortFree,
    shutdownPortFree,
    reason,
  }
}

export function readScene(identity: TrackedProcess): { pid: number, cwd: string, entry: string, startedAt: string, stdout: string, stderr: string } {
  return {
    pid: identity.pid,
    cwd: identity.cwd,
    entry: identity.entry,
    startedAt: identity.startedAt,
    stdout: identity.stdout.slice(-2000),
    stderr: identity.stderr.slice(-2000),
  }
}
