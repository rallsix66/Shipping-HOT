// Evidence gate runner (R2). Runs each gate with spawnSync and writes UTF-8 logs that carry
// the command, the full SHA, stdout/stderr and the raw exit code. Run from the repo root: node docs/evidence/run-gates.cjs
const { execSync, spawnSync } = require("node:child_process")
const fs = require("node:fs")
const process = require("node:process")

const sha = execSync("git rev-parse HEAD").toString().trim()
const clean = execSync("git status --porcelain").toString().trim() === ""
const dir = `docs/evidence/gate-${sha.slice(0, 7)}`
fs.mkdirSync(dir, { recursive: true })
const bash = "\"C:\\Program Files\\Git\\bin\\bash.exe\""
const scope = "server/intel server/runtime/intel-collect-job.ts server/database/intel.ts server/database/migrations/023-intel-executor-current.ts server/database/migrations/024-paid-receipt.ts server/database/migrations/025-paid-receipt-usage-booking.ts server/services/paid-budget.ts server/providers/feed.ts server/services/article-fetch-security.ts"
const commands = [
  ["install", "pnpm install --frozen-lockfile"],
  ["build", "pnpm build"],
  ["typecheck", "pnpm typecheck"],
  ["lint", "pnpm lint"],
  ["targeted-intel", "npx vitest run server/intel"],
  ["targeted-paid-receipt", "npx vitest run server/intel/llm server/services/translation"],
  ["targeted-feed-safe-fetch", "npx vitest run server/providers/feed.test.ts server/runtime/feed-sync-job.test.ts server/services/article server/runtime/article server/runtime/registry.test.ts"],
  ["test", "pnpm test --run"],
  ["smoke-p0-native", "pnpm smoke:p0-native"],
  ["smoke-p2c-runtime", "pnpm smoke:p2c-runtime"],
  ["smoke-p3-feed-freshness", "pnpm smoke:p3-feed-freshness"],
  ["scan-network-llm", `rg -n -i "fetch\\(|https?://|openai|anthropic|llm" ${scope}`],
  ["scan-secrets", `rg -n -i "(api[_-]?key|secret|token|password)\\s*[:=]\\s*.[A-Za-z0-9_-]{12,}" ${scope}`],
  ["neat-freak-inventory", `${bash} scripts/audit-inventory.sh .`],
]
const summary = [`full_sha=${sha}`, `worktree_clean_before_gates=${clean}`, `node=${process.version}`, "runner=docs/evidence/run-gates.cjs (spawnSync, UTF-8 capture)"]
for (const [name, command] of commands) {
  const started = new Date().toISOString()
  const result = spawnSync(command, { shell: true, encoding: "utf8", maxBuffer: 1 << 28 })
  const code = result.status === null ? `signal:${result.signal}` : result.status
  const log = `# command: ${command}\n# full_sha: ${sha}\n# started: ${started}\n# ---- stdout ----\n${result.stdout || ""}\n# ---- stderr ----\n${result.stderr || ""}\n# raw_exit_code: ${code}\n`
  fs.writeFileSync(`${dir}/${name}.log`, log, "utf8")
  summary.push(`${name} raw_exit_code=${code}  cmd: ${command}`)
}
summary.push("note: rg exit 1 = no match; audit-inventory.sh is an inventory only, not a security audit.")
fs.writeFileSync(`${dir}/summary.txt`, `${summary.join("\n")}\n`, "utf8")
console.log(summary.join("\n"))
