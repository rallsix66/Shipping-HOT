import { spawn } from "node:child_process"
import type { Buffer } from "node:buffer"
import { createRequire } from "node:module"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import process from "node:process"
import NativeDatabase from "better-sqlite3"
import { afterEach, describe, expect, it } from "vitest"
import {
  type TrackedProcess,
  assertDisplayCounters,
  assertSourceProofUnchanged,
  buildDisplayLaunchPlan,
  compareSnapshots,
  copyDisplayDatabase,
  createShutdownToken,
  readDisplaySnapshot,
  readSourceProof,
  reserveLoopbackPort,
  startTrackedProcess,
  stopTrackedProcess,
} from "./ph-m01-display-prep"

const require = createRequire(join(process.cwd(), "package.json"))
const guard = require("./scripts/lib/ph-m01-display-guard.cjs") as {
  DENIED: string
  parseAllowList: (value?: string) => Array<{ host: string, port: number }>
  installDisplayEgressGuard: (options: { allow: Array<{ host: string, port: number }>, modules: Record<string, unknown> }) => { restore: () => void }
  installShutdownLatch: (options: { host?: string, port: number, token: string, emit: (signal: string) => void }) => { close: (callback?: () => void) => void, address: () => { port: number } | string | null }
}

const roots: string[] = []
const leftovers: TrackedProcess[] = []

afterEach(async () => {
  await Promise.all(leftovers.splice(0).map(tracked => new Promise<void>((resolveDone) => {
    if (tracked.child.exitCode !== null || tracked.child.signalCode) {
      resolveDone()
      return
    }
    const timer = setTimeout(resolveDone, 2000)
    tracked.child.once("exit", () => {
      clearTimeout(timer)
      resolveDone()
    })
    tracked.child.kill()
  })))
  for (const root of roots.splice(0)) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        rmSync(root, { recursive: true, force: true })
        break
      } catch (error) {
        if (attempt === 4) throw error
        await new Promise(resolveRetry => setTimeout(resolveRetry, 100))
      }
    }
  }
})

function childEnv(extra: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra }
  delete env.NODE_OPTIONS
  return env
}

function workspace(): string {
  const root = mkdtempSync(join(process.cwd(), ".tmp", "ph-m01-display-guard-"))
  roots.push(root)
  mkdirSync(join(root, ".tmp"))
  return root
}

function callsOf() {
  const calls: string[] = []
  const mark = (name: string) => {
    calls.push(name)
    const error = new Error(name) as NodeJS.ErrnoException
    error.code = "UNDERLYING"
    throw error
  }
  return { calls, mark }
}

function fakeModules(mark: (name: string) => void) {
  const assigned: { fetch?: (input: unknown) => Promise<unknown> } = {}
  const dns = {
    lookup: () => mark("dns.lookup"),
    resolve4: () => mark("dns.resolve4"),
    promises: {
      lookup: () => mark("dns.promises.lookup"),
      resolve4: () => mark("dns.promises.resolve4"),
    },
    Resolver: { prototype: { lookup: () => mark("dns.Resolver.lookup"), resolve4: () => mark("dns.Resolver.resolve4") } },
  }
  const http = { request: () => mark("http.request"), get: () => mark("http.get") }
  const socket = { send: () => mark("dgram.send") }
  return {
    callsHolder: assigned,
    modules: {
      net: { Socket: { prototype: { connect: () => mark("connect") } } },
      dns,
      http,
      https: { request: () => mark("https.request"), get: () => mark("https.get") },
      tls: { connect: () => mark("tls.connect") },
      http2: { connect: () => mark("http2.connect") },
      dgram: { createSocket: () => socket },
      childProcess: { spawn: () => mark("spawn"), execFile: () => mark("execFile") },
      fetch: () => mark("fetch"),
      assignFetch(next: (input: unknown) => Promise<unknown>) {
        assigned.fetch = next
      },
    },
  }
}

describe("display egress guard", () => {
  it("rejects a non-exact allow entry before any socket exists", () => {
    expect(() => guard.parseAllowList("localhost:9")).toThrow(guard.DENIED)
    expect(() => guard.parseAllowList("0.0.0.0:9")).toThrow(guard.DENIED)
    expect(() => guard.parseAllowList("127.0.0.1:9,127.0.0.1:10")).not.toThrow()
    expect(guard.parseAllowList("")).toEqual([])
  })

  it("does not call the underlying network functions for a rejected target", async () => {
    const { calls, mark } = callsOf()
    const { modules, callsHolder } = fakeModules(mark)
    const installed = guard.installDisplayEgressGuard({ allow: [{ host: "127.0.0.1", port: 9 }], modules })
    const connect = modules.net.Socket.prototype.connect as (port: number, host: string) => void
    expect(() => connect(9, "192.0.2.1")).toThrow(guard.DENIED)
    expect(() => connect(10, "127.0.0.1")).toThrow(guard.DENIED)
    expect(() => connect(9, "localhost")).toThrow(guard.DENIED)
    expect(() => (modules.http.request as (url: string) => void)("http://192.0.2.1/path")).toThrow(guard.DENIED)
    expect(() => (modules.https.request as (url: string) => void)("https://127.0.0.1/path")).toThrow(guard.DENIED)
    expect(() => (modules.tls.connect as (port: number, host: string) => void)(443, "192.0.2.1")).toThrow(guard.DENIED)
    expect(() => (modules.http2.connect as (url: string) => void)("https://192.0.2.1/")).toThrow(guard.DENIED)
    expect(() => (modules.childProcess.spawn as () => void)()).toThrow(guard.DENIED)
    expect(() => (modules.dns.resolve4 as () => void)()).toThrow(guard.DENIED)
    expect(() => (modules.dns.Resolver.prototype.resolve4 as () => void)()).toThrow(guard.DENIED)
    const lookup = modules.dns.lookup as (host: string, callback: (error: NodeJS.ErrnoException | null) => void) => void
    await new Promise<void>((resolveDone) => {
      lookup("example.com", (error) => {
        expect(error?.code).toBe(guard.DENIED)
        resolveDone()
      })
    })
    await expect((modules.dns.promises.lookup as unknown as (host: string) => Promise<unknown>)("example.com")).rejects.toMatchObject({ code: guard.DENIED })
    await expect(callsHolder.fetch?.("http://192.0.2.1/feed")).rejects.toMatchObject({ code: guard.DENIED })
    const udp = (modules.dgram.createSocket as () => { send: () => void })()
    expect(() => udp.send()).toThrow(guard.DENIED)
    expect(calls).toEqual([])
    expect(() => connect(9, "127.0.0.1")).toThrow(expect.objectContaining({ code: "UNDERLYING" }))
    expect(calls).toEqual(["connect"])
    installed.restore()
  })

  it("answers an exact loopback lookup without the original resolver", async () => {
    const { calls, mark } = callsOf()
    const { modules } = fakeModules(mark)
    const installed = guard.installDisplayEgressGuard({ allow: [], modules })
    const lookup = modules.dns.promises.lookup as unknown as (host: string) => Promise<{ address: string }>
    await expect(lookup("127.0.0.1")).resolves.toMatchObject({ address: "127.0.0.1" })
    expect(calls).toEqual([])
    installed.restore()
  })
})

describe("display database proof", () => {
  function seed(path: string, title = "Notice 1"): void {
    const db = new NativeDatabase(path)
    db.exec(`
      CREATE TABLE app_metadata (id TEXT, schema_version INTEGER, bootstrap_completed_at TEXT, database_id TEXT, last_migration_at TEXT, data_mode TEXT);
      CREATE TABLE settings (id TEXT, data TEXT, updated_at TEXT);
      CREATE TABLE port_directory_status (id TEXT, port_directory_status TEXT);
      CREATE TABLE schema_migrations (version INTEGER, name TEXT, applied_at TEXT);
      CREATE TABLE intel_item (id TEXT, source_id TEXT, canonical_url TEXT, title TEXT, published_at TEXT, first_seen_at TEXT, last_seen_at TEXT, current_version_id TEXT);
      CREATE TABLE intel_item_version (id TEXT, item_id TEXT, content_hash TEXT, fetched_at TEXT, extractor_version TEXT, content_scope TEXT, source_published_at TEXT, source_updated_at TEXT, created_at TEXT);
      CREATE TABLE intel_item_block (id TEXT, version_id TEXT, block_key TEXT, block_order INTEGER, block_type TEXT, text TEXT);
      CREATE TABLE intel_fetch_run (id TEXT, state TEXT);
      CREATE TABLE provider_usage (id TEXT, request_count INTEGER);
      CREATE TABLE provider_runtime (id TEXT, state TEXT);
      INSERT INTO app_metadata VALUES ('default', 29, '2026-10-24T00:00:00.000Z', 'db-1', '2026-10-24T00:00:00.000Z', 'real');
      INSERT INTO settings VALUES ('default', '{}', '2026-10-24T00:00:00.000Z');
      INSERT INTO port_directory_status VALUES ('default', 'pending');
      INSERT INTO schema_migrations VALUES (29, 'manual-clip', '2026-10-24T00:00:00.000Z');
      INSERT INTO intel_fetch_run VALUES ('run-1', 'closed');
    `)
    const insertItem = db.prepare("INSERT INTO intel_item VALUES (?, 'intel:ph-m01', ?, ?, '2026-10-13T02:00:00.000Z', '2026-10-24T00:00:00.000Z', '2026-10-24T00:00:00.000Z', ?)")
    const insertVersion = db.prepare("INSERT INTO intel_item_version VALUES (?, ?, ?, '2026-10-24T00:00:00.000Z', 'ph-m01', 'metadata_only', '2026-10-13T02:00:00.000Z', NULL, '2026-10-24T00:00:00.000Z')")
    const insertBlock = db.prepare("INSERT INTO intel_item_block VALUES (?, ?, 'title', 0, 'title', ?)")
    for (let index = 1; index <= 10; index += 1) {
      const itemId = `item-${index}`
      const versionId = `version-${index}`
      insertItem.run(itemId, `https://portcalls.com/notice-${index}`, index === 1 ? title : `Notice ${index}`, versionId)
      insertVersion.run(versionId, itemId, `hash-${index}`)
      insertBlock.run(`block-${index}`, versionId, index === 1 ? title : `Notice ${index}`)
    }
    db.close()
  }

  it("copies with backup, keeps the source hash, and rejects an existing or reserved directory", async () => {
    const root = workspace()
    const source = join(root, ".tmp", "synthetic.sqlite3")
    seed(source)
    const before = await readSourceProof(source)
    const displayDir = join(root, ".tmp", "fresh-display")
    const copied = await copyDisplayDatabase({ repoRoot: root, sourcePath: source, displayDir })
    const after = await readSourceProof(source)
    assertSourceProofUnchanged(before, after)
    expect(copied.source.sha256).toBe(before.sha256)
    expect(copied.copySnapshot.counts).toMatchObject({ intel_item: 10, intel_fetch_run: 1, provider_usage: 0, provider_runtime: 0 })
    expect(copied.copySnapshot.items[0]).toMatchObject({ title: "Notice 1", canonical_url: "https://portcalls.com/notice-1", text: "Notice 1" })
    await expect(copyDisplayDatabase({ repoRoot: root, sourcePath: source, displayDir })).rejects.toThrow(/display_dir_exists/)
    await expect(copyDisplayDatabase({ repoRoot: root, sourcePath: source, displayDir: join(root, ".tmp", "s7-local") })).rejects.toThrow(/display_dir_reserved/)
  })

  it("stops when a WAL sidecar is present and does not create the display directory", async () => {
    const root = workspace()
    const source = join(root, ".tmp", "wal.sqlite3")
    const db = new NativeDatabase(source)
    db.exec("PRAGMA journal_mode = WAL")
    db.exec("CREATE TABLE kept (id INTEGER); INSERT INTO kept VALUES (1)")
    const before = readFileSync(source)
    await expect(copyDisplayDatabase({
      repoRoot: root,
      sourcePath: source,
      displayDir: join(root, ".tmp", "should-not-exist"),
    })).rejects.toThrow(/sqlite_sidecar_present/)
    expect(existsSync(join(root, ".tmp", "should-not-exist"))).toBe(false)
    expect(readFileSync(source).equals(before)).toBe(true)
    db.close()
  })

  it("rejects a directory junction that leaves .tmp", async () => {
    const root = workspace()
    const source = join(root, ".tmp", "synthetic.sqlite3")
    seed(source)
    const outside = mkdtempSync(join(tmpdir(), "ph-m01-display-outside-"))
    roots.push(outside)
    const jump = join(root, ".tmp", "jump")
    symlinkSync(outside, jump, "junction")
    await expect(copyDisplayDatabase({
      repoRoot: root,
      sourcePath: source,
      displayDir: join(jump, "escaped"),
    })).rejects.toThrow(/display_dir_escapes_tmp/)
    expect(existsSync(join(outside, "escaped"))).toBe(false)
  })

  it("detects a same-count content change and separates init metadata from the read window", () => {
    const root = workspace()
    const source = join(root, ".tmp", "synthetic.sqlite3")
    seed(source)
    const before = readDisplaySnapshot(source)
    assertDisplayCounters(before, { intel_item: 10, intel_item_version: 10, intel_item_block: 10, intel_fetch_run: 1, provider_usage: 0, provider_runtime: 0 })
    const same = readDisplaySnapshot(source)
    expect(compareSnapshots(before, same, "read").ok).toBe(true)

    const db = new NativeDatabase(source)
    db.prepare("UPDATE app_metadata SET last_migration_at = '2026-10-24T01:00:00.000Z', data_mode = 'real'").run()
    const initialized = readDisplaySnapshot(source)
    const initDiff = compareSnapshots(before, initialized, "init")
    expect(initDiff.ok).toBe(true)
    expect(initDiff.allowed.join(" ")).toContain("last_migration_at")
    expect(compareSnapshots(initialized, readDisplaySnapshot(source), "read").ok).toBe(true)

    db.prepare("UPDATE intel_item SET title = 'changed' WHERE id = 'item-1'").run()
    db.prepare("UPDATE intel_item_block SET text = 'changed block' WHERE id = 'block-1'").run()
    const changed = readDisplaySnapshot(source)
    const readDiff = compareSnapshots(initialized, changed, "read")
    expect(readDiff.ok).toBe(false)
    expect(readDiff.unexpected.join("\n")).toMatch(/title/)
    expect(readDiff.unexpected.join("\n")).toMatch(/text/)
    db.prepare("UPDATE intel_item SET title = 'Notice 1' WHERE id = 'item-1'").run()
    db.prepare("UPDATE intel_item_block SET text = 'Notice 1' WHERE id = 'block-1'").run()
    db.prepare("INSERT INTO provider_usage VALUES ('usage-1', 1)").run()
    const usage = readDisplaySnapshot(source)
    expect(compareSnapshots(before, usage, "read").unexpected.join("\n")).toMatch(/provider_usage/)
    db.close()
  })

  it("reports a source hash change instead of treating size as proof", async () => {
    const root = workspace()
    const source = join(root, ".tmp", "synthetic.sqlite3")
    seed(source)
    const before = await readSourceProof(source)
    const db = new NativeDatabase(source)
    db.prepare("UPDATE intel_item SET canonical_url = 'https://portcalls.com/notice-X' WHERE id = 'item-2'").run()
    db.close()
    const after = await readSourceProof(source)
    expect(before.sha256).not.toBe(after.sha256)
    expect(() => assertSourceProofUnchanged(before, after)).toThrow(/source_changed_during_copy/)
  })
})

describe("display process stop", () => {
  function entry(root: string, name: string, body: string): string {
    const path = join(root, name)
    writeFileSync(path, body)
    return path
  }

  async function launch(root: string, body: string, timeoutMs = 3000): Promise<TrackedProcess> {
    const shutdownPort = await reserveLoopbackPort()
    const token = createShutdownToken()
    const cwd = join(root, "cwd-slot")
    mkdirSync(cwd)
    const started = await startTrackedProcess({
      repoRoot: process.cwd(),
      entry: entry(root, "fake-server.cjs", body),
      cwd,
      env: childEnv({
        PH_M01_DISPLAY_GUARD: "1",
        PH_M01_DISPLAY_ALLOW: "",
        PH_M01_DISPLAY_SHUTDOWN_PORT: String(shutdownPort),
        PH_M01_DISPLAY_SHUTDOWN_TOKEN: token,
      }),
      ready: /app-listening (\d+)/,
      timeoutMs,
    })
    leftovers.push(started.identity)
    return started.identity
  }

  it("stops through the in-process SIGTERM latch and confirms exit separately from the port", async () => {
    const root = workspace()
    const identity = await launch(root, `
      const http = require("node:http");
      const fs = require("node:fs");
      const server = http.createServer((req, res) => res.end("ok"));
      process.on("SIGTERM", () => server.close(() => process.exit(0)));
      server.listen(0, "127.0.0.1", () => fs.writeSync(1, "app-listening " + server.address().port + "\\n"));
    `)
    expect(identity.pid).toBeGreaterThan(0)
    expect(identity.cwd.endsWith("cwd-slot")).toBe(true)
    expect(identity.args.join(" ")).not.toContain("cwd-slot")
    expect(identity.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    const kill = identity.child.kill.bind(identity.child)
    let killCalls = 0
    identity.child.kill = ((...args: unknown[]) => {
      killCalls += 1
      return kill(...(args as []))
    }) as typeof identity.child.kill
    const stopped = await stopTrackedProcess(identity, 2000)
    expect(stopped.graceful).toBe(true)
    expect(stopped.confirmed).toBe(true)
    expect(stopped.exited).toBe(true)
    expect(stopped.exitCode).toBe(0)
    expect(stopped.signalCode).toBeNull()
    expect(stopped.appPortFree).toBe(true)
    expect(stopped.shutdownPortFree).toBe(true)
    expect(killCalls).toBe(0)
    const again = await stopTrackedProcess(identity, 500)
    expect(again.alreadyExited).toBe(true)
    expect(again.confirmed).toBe(true)
    expect(again.graceful).toBe(false)
    expect(killCalls).toBe(0)
  })

  it("records failure when the process closes its port but does not exit", async () => {
    const root = workspace()
    const identity = await launch(root, `
      const http = require("node:http");
      const fs = require("node:fs");
      const server = http.createServer((req, res) => res.end("ok"));
      process.on("SIGTERM", () => server.close());
      setInterval(() => {}, 1000);
      server.listen(0, "127.0.0.1", () => fs.writeSync(1, "app-listening " + server.address().port + "\\n"));
    `)
    const stopped = await stopTrackedProcess(identity, 600)
    expect(stopped.confirmed).toBe(false)
    expect(stopped.graceful).toBe(false)
    expect(stopped.exited).toBe(false)
    expect(stopped.appPortFree).toBe(true)
    expect(stopped.reason).toContain("process_still_alive")
  })

  it("records failure when the fake server ignores the stop", async () => {
    const root = workspace()
    const identity = await launch(root, `
      const http = require("node:http");
      const fs = require("node:fs");
      const server = http.createServer((req, res) => res.end("ok"));
      setInterval(() => {}, 1000);
      server.listen(0, "127.0.0.1", () => fs.writeSync(1, "app-listening " + server.address().port + "\\n"));
    `)
    const stopped = await stopTrackedProcess(identity, 600)
    expect(stopped.confirmed).toBe(false)
    expect(stopped.exited).toBe(false)
    expect(stopped.appPortFree).toBe(false)
  })

  it("records startup failure without reporting a running server", async () => {
    const root = workspace()
    const shutdownPort = await reserveLoopbackPort()
    const started = await startTrackedProcess({
      repoRoot: process.cwd(),
      entry: entry(root, "exit-now.cjs", "process.exit(3)\n"),
      cwd: root,
      env: childEnv({
        PH_M01_DISPLAY_GUARD: "1",
        PH_M01_DISPLAY_ALLOW: "",
        PH_M01_DISPLAY_SHUTDOWN_PORT: String(shutdownPort),
        PH_M01_DISPLAY_SHUTDOWN_TOKEN: createShutdownToken(),
      }),
      ready: /app-listening (\d+)/,
      timeoutMs: 3000,
    })
    leftovers.push(started.identity)
    expect(started.ok).toBe(false)
    expect(started.reason).toBe("startup_exit")
    expect(started.exitCode).toBe(3)
    const stopped = await stopTrackedProcess(started.identity, 500)
    expect(stopped.graceful).toBe(false)
    expect(stopped.exited).toBe(true)
    expect(stopped.confirmed).toBe(false)
  })
})

describe("display launch plan", () => {
  it("keeps the browser block unready and the server allow list empty", () => {
    const plan = buildDisplayLaunchPlan({
      repoRoot: process.cwd(),
      displayDir: join(process.cwd(), ".tmp", "ph-m01-display-example"),
      port: 4411,
      shutdownPort: 4412,
      token: "a".repeat(32),
      baseEnv: { DEEPSEEK_API_KEY: "secret", HTTP_PROXY: "http://192.0.2.1:8080", NODE_OPTIONS: "--require something" },
    })
    expect(plan.browserRequestBlock).toBe("not_ready")
    expect(plan.allow).toEqual([])
    expect(plan.env.PH_M01_DISPLAY_ALLOW).toBe("")
    expect(plan.env.NITRO_HOST).toBe("127.0.0.1")
    expect(plan.env.SHIPPING_RUNTIME_ENABLED).toBe("false")
    expect(plan.env.SHIPPING_INTEL_ENABLED).toBe("false")
    expect(plan.env.DEEPSEEK_API_KEY).toBeUndefined()
    expect(plan.env.HTTP_PROXY).toBeUndefined()
    expect(plan.env.NODE_OPTIONS).toBeUndefined()
    expect(plan.command.join(" ")).toContain("--require")
    expect(plan.command.join(" ")).not.toContain("ph-m01-display-example")
  })
})

describe("preload order", () => {
  it("blocks before the sentinel underlying connect and lookup", async () => {
    const root = workspace()
    const sentinel = join(root, "sentinel.cjs")
    const entry = join(root, "entry.mjs")
    writeFileSync(sentinel, `
      const fs = require("node:fs");
      function mark(kind) {
        fs.writeSync(1, "UNDERLYING " + kind + "\\n");
        const error = new Error(kind);
        error.code = "UNDERLYING";
        throw error;
      }
      const net = require("node:net");
      const dns = require("node:dns");
      const http = require("node:http");
      const childProcess = require("node:child_process");
      net.Socket.prototype.connect = function () { mark("connect"); };
      dns.lookup = function () { mark("lookup"); };
      dns.promises.lookup = function () { mark("promises.lookup"); };
      http.request = function () { mark("http"); };
      childProcess.spawn = function () { mark("spawn"); };
      globalThis.fetch = function () { mark("fetch"); };
    `)
    writeFileSync(entry, `
      import * as net from "node:net";
      import * as dns from "node:dns";
      import * as http from "node:http";
      import { spawn } from "node:child_process";
      const pending = [];
      function report(name, error) {
        const code = error && typeof error === "object" ? (error.code || error.message) : String(error);
        process.stdout.write("RESULT " + name + " " + code + "\\n");
      }
      function attempt(name, fn) {
        try {
          const value = fn();
          if (value && typeof value.then === "function") pending.push(value.then(() => report(name, "resolved"), (error) => report(name, error)));
        } catch (error) {
          report(name, error);
        }
      }
      attempt("connect", () => new net.Socket().connect(9, "192.0.2.1"));
      attempt("other-port", () => new net.Socket().connect(10, "127.0.0.1"));
      attempt("http", () => http.request("http://192.0.2.1/"));
      attempt("spawn", () => spawn(process.execPath, ["-e", "process.exit(0)"]));
      attempt("lookup", () => dns.promises.lookup("example.com"));
      attempt("fetch", () => globalThis.fetch("http://192.0.2.1/feed"));
      Promise.all(pending).then(() => process.exit(0));
    `)
    const child = spawn(process.execPath, ["--require", sentinel, "--require", join(process.cwd(), "scripts", "lib", "ph-m01-display-guard.cjs"), entry], {
      env: childEnv({
        PH_M01_DISPLAY_GUARD: "1",
        PH_M01_DISPLAY_ALLOW: "127.0.0.1:9",
        PH_M01_DISPLAY_SHUTDOWN_PORT: "0",
        PH_M01_DISPLAY_SHUTDOWN_TOKEN: "b".repeat(32),
      }),
      windowsHide: true,
    })
    let stdout = ""
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8")
    })
    const exitCode = await new Promise<number | null>((resolveExit) => {
      const timer = setTimeout(() => {
        child.kill()
        resolveExit(null)
      }, 5000)
      child.once("exit", (code) => {
        clearTimeout(timer)
        resolveExit(code)
      })
    })
    expect(exitCode).toBe(0)
    expect(stdout).not.toContain("UNDERLYING")
    expect(stdout).toContain("RESULT connect display_egress_denied")
    expect(stdout).toContain("RESULT lookup display_egress_denied")
    expect(stdout).toContain("RESULT fetch display_egress_denied")
    expect(stdout).toContain("RESULT spawn display_egress_denied")
  })
})
