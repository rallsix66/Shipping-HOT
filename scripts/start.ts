import { loadServerEnv } from "./load-env"

loadServerEnv()
const serverEntry = new URL("../dist/output/server/index.mjs", import.meta.url)
await import(serverEntry.href)
