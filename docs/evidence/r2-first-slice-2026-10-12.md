# R2 首切片证据（2026-10-12）

- 分支 `codex/shipping-hot-r2`，起点 `2939762da884aa9ae04f16e8d8bcccdeb5f148e5`。
- 代码提交：`de8a7b6518ec59198fc5f16c6e1dcf39bf259c95`（首切片）+ `b12c3477e979813c3c33d2908f461b80beab13ba`（补改 translation.test.ts 里写死的最新 schema 版本 20 → 22）。
- 设计与覆盖说明：`docs/plans/r2-first-slice-2026-10-12.md`。

## 门禁（原始 exit code）
**第一次，干净 `de8a7b6`**（`gate-de8a7b6/summary.txt`）：install 0、build 0、typecheck 0、lint 0、**vitest 1**（100 个文件，841 通过，1 失败，3 跳过）、smoke:p0-native 0、smoke:p2c-runtime 0、smoke:p3-feed-freshness 0。
失败的是 `server/database/translation.test.ts` 第 73 行：它断言最新迁移版本是 20，加了 021/022 以后是 22。这是写死的期望值，不是行为回归；首切片提交前只替换了 `toBe(20)` 形式的断言，漏掉了这处 `toEqual({ version: 20 })`。

**第二次，干净 `b12c347`**（`gate-b12c347/summary.txt`）：install 0、build 0、typecheck 0、lint 0、**vitest 0（100 个文件，842 通过，3 跳过）**、R2 定向 vitest 0（6 个文件 58 通过：intel、feed-formats、feed、background-runtime、feed-sync-job、article-fetch-security）、smoke:p0-native 0、smoke:p2c-runtime 0、smoke:p3-feed-freshness 0。
已有的 Feed / 天气 / 日历 / 政策 / 翻译测试都包含在全量 vitest 里，均通过。本轮没有跑浏览器验收（没有界面改动），也没有跑任何 live 脚本。

## 迁移与幂等
- 隔离内存库从零初始化到 v22，重复初始化后 `schema_migrations` 里 21、22 各只有 1 行（`collect.test.ts` “migrations 021/022”）。
- 现有的 v17→v20 升级矩阵测试（policy.test.ts）现在继续升级到 v22，全部通过。
- 重复采集同一真实存档：item / version / block 行数不变，itemsNew=0、itemsRevised=0。

## 零外网 / 零 LLM
- `gate-b12c347/network-llm-scan.txt`：在 intel 新文件里查 `fetch(`、`node:http(s)`、`node:dns`、`undici`、`$fetch`、`openai`、`deepseek`、`apiKey`、`secret`、`credential`，rg exit 1（= 无匹配）；`registry.ts` 和 `server/api` 里查 `intel`，rg exit 1（= 无匹配，未接线、无 GET 接口）。
- intel 只通过 `secureFetchArticle` 访问网络，而且 `lookup` 和 `transport` 都必须由调用方注入；不注入时 job 直接返回 `offline_fetcher_not_configured`（有测试）。job 默认 `enabled=false`。
- 测试里的 transport 只读存档字符串，`lookup` 返回固定的公网地址字面量，不发生 DNS 或连接。

## 未覆盖
见设计文档 §7：R2-3 paid_receipt 等（仍在 R2 验收内）、Feed 同步接入安全抓取与按信源 CA、web_list/json_list/日期/编码、P1 实网核验（未安排）、P1 全量夹具、人工录入、24 小时实网（需单独确认）、registry 接线与 GET 接口。历史 1/10、PAGASA、促销缺口照旧。
