import process from "node:process"
import { join } from "node:path"
import dotenv from "dotenv"
import { projectDir } from "../shared/dir"

export interface LoadServerEnvOptions {
  rootDir?: string
  processEnv?: NodeJS.ProcessEnv
}

/** Load local overrides first, then fill missing values from the shared server template. */
export function loadServerEnv(options: LoadServerEnvOptions = {}) {
  const rootDir = options.rootDir ?? projectDir
  const processEnv = options.processEnv ?? process.env
  for (const fileName of [".env.local", ".env.server"]) {
    dotenv.config({
      path: join(rootDir, fileName),
      override: false,
      processEnv,
      quiet: true,
    })
  }
  return processEnv
}
