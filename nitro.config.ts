import { join } from "node:path"
import viteNitro from "vite-plugin-with-nitro"
import { projectDir } from "./shared/dir"

const nitroOption: Parameters<typeof viteNitro>[0] = {
  experimental: {
    database: true,
  },
  // Never scan test files as production API routes.
  ignore: ["**/*.test.ts", "**/*.spec.ts"],
  sourceMap: false,
  // No baked-in absolute `cwd`: db0 resolves `.data/<name>.sqlite3` against the
  // process working directory at runtime. `pnpm dev`, `pnpm start` and the
  // container all run from the project/app root and therefore use the same
  // `.data/shipping-hot-v3.sqlite3`; an isolated cwd yields an isolated DB for
  // testing. `SHIPPING_DATABASE_PATH` is honored by the CLI smoke tools, not here.
  database: {
    default: {
      connector: "better-sqlite3",
      options: {
        name: "shipping-hot-v3",
      },
    },
  },
  devDatabase: {
    default: {
      connector: "better-sqlite3",
      options: {
        name: "shipping-hot-v3",
      },
    },
  },
  imports: {
    dirs: ["server/utils", "shared"],
  },
  preset: "node-server",
  alias: {
    "@shared": join(projectDir, "shared"),
    "#": join(projectDir, "server"),
  },
}

// This project runs as a local Node server with SQLite. Edge/Cloudflare/Bun
// presets cannot support the native better-sqlite3 + background Runtime model
// and are intentionally retired (no CF/Vercel/Bun deployment entry).
export default function () {
  return viteNitro(nitroOption)
}
