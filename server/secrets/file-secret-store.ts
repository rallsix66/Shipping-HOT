import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises"
import { execFile as execFileCallback } from "node:child_process"
import process from "node:process"
import { promisify } from "node:util"
import { dirname, join } from "node:path"
import type { ProviderSecret, SecretSource, SecretStore } from "#/providers/contracts"

type SecretRecord = Record<string, string>
const execFile = promisify(execFileCallback)

const knownEnvironmentNames: Record<string, string> = {
  "deepseek": "DEEPSEEK_API_KEY",
  "qwen-mt": "QWEN_MT_API_KEY",
  "gemini": "GEMINI_API_KEY",
  "openai": "OPENAI_API_KEY",
  "claude": "ANTHROPIC_API_KEY",
  "deepl": "DEEPL_API_KEY",
  "azure": "AZURE_TRANSLATOR_API_KEY",
  "vesselapi": "VESSELAPI_API_KEY",
  "aisstream": "AISSTREAM_API_KEY",
}

export class SecretManagedByEnvironmentError extends Error {
  statusCode = 409
  statusMessage = "managed_by_environment"

  constructor() {
    super("managed_by_environment")
  }
}

function environmentName(providerId: string): string {
  return knownEnvironmentNames[providerId] ?? `${providerId.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}_API_KEY`
}

function maskSecret(secret: string): string {
  return `****${secret.slice(-4)}`
}

async function readRecord(path: string): Promise<SecretRecord> {
  try {
    const raw = await readFile(path, "utf8")
    const value = JSON.parse(raw) as unknown
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_secret_store")
    return Object.fromEntries(Object.entries(value).filter(([, secret]) => typeof secret === "string"))
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && (error as { code?: string }).code === "ENOENT") return {}
    throw new Error("invalid_secret_store")
  }
}

export interface FileSecretStoreOptions {
  path?: string
  environment?: NodeJS.ProcessEnv
}

export class FileSecretStore implements SecretStore {
  readonly path: string
  private readonly environment: NodeJS.ProcessEnv

  constructor(options: FileSecretStoreOptions = {}) {
    this.path = options.path ?? join(process.cwd(), ".data", "provider-secrets.json")
    this.environment = options.environment ?? process.env
  }

  private environmentSecret(providerId: string): string | undefined {
    const value = this.environment[environmentName(providerId)]
    return value && value.length > 0 ? value : undefined
  }

  async get(providerId: string): Promise<string | undefined> {
    const environmentSecret = this.environmentSecret(providerId)
    if (environmentSecret) return environmentSecret
    const record = await readRecord(this.path)
    return record[providerId]
  }

  async source(providerId: string): Promise<SecretSource> {
    if (this.environmentSecret(providerId)) return "environment"
    const record = await readRecord(this.path)
    return record[providerId] ? "file" : "missing"
  }

  async has(providerId: string): Promise<boolean> {
    return Boolean(await this.get(providerId))
  }

  async set(providerId: string, secret: string): Promise<void> {
    if (this.environmentSecret(providerId)) throw new SecretManagedByEnvironmentError()
    if (!secret) throw new Error("secret_required")
    const record = await readRecord(this.path)
    record[providerId] = secret
    await this.writeRecord(record)
  }

  async delete(providerId: string): Promise<void> {
    if (this.environmentSecret(providerId)) throw new SecretManagedByEnvironmentError()
    const record = await readRecord(this.path)
    if (!(providerId in record)) return
    delete record[providerId]
    await this.writeRecord(record)
  }

  async redacted(providerId: string): Promise<ProviderSecret> {
    const secret = await this.get(providerId)
    return {
      providerId,
      configured: Boolean(secret),
      source: await this.source(providerId),
      maskedLast4: secret ? maskSecret(secret) : undefined,
    }
  }

  private async writeRecord(record: SecretRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.tmp-${process.pid}-${Date.now()}`
    try {
      await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
      await chmod(temporaryPath, 0o600).catch(() => undefined)
      await rename(temporaryPath, this.path)
      await this.lockDown(this.path)
    } finally {
      await unlink(temporaryPath).catch(() => undefined)
    }
  }

  private async lockDown(path: string): Promise<void> {
    await chmod(path, 0o600).catch(() => undefined)
    if (process.platform !== "win32") return
    const username = process.env.USERNAME
    if (!username) throw new Error("secret_store_permissions_failed")
    const principal = `${process.env.USERDOMAIN ?? process.env.COMPUTERNAME ?? "."}\\${username}`
    try {
      // Preserve inherited sandbox/service access while disabling future inheritance and granting the runtime user full control.
      await execFile("icacls.exe", [path, "/inheritance:d", "/grant:r", `${principal}:F`], { windowsHide: true })
    } catch {
      throw new Error("secret_store_permissions_failed")
    }
  }
}
