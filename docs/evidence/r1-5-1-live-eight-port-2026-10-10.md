# R1.5-1 八港实网验收证据（2026-10-10，第二轮复审修复后）

> 结论：**BLOCKED**。七港七天海况和陆地预报覆盖 PASS，**VNSGN 海况缺测**，所以 R1.5-1 整体仍 BLOCKED。不合并、不部署。

## 口径来源

- 「7 天」：9/29 主方案 R1.5-1，要求 8 个港口都有 7 天的海况和陆地预报。
- 具体滚动窗口 `[now−1h, now+7d]`：现有 `server/services/weather-panel-policy.ts`（`isForecastInstantInWindow`、`WEATHER_FORECAST_HORIZON_MS`）。
- 核验方式：窗口内每个 UTC 整点都要恰好出现一次（唯一、首尾都在、无缺口），并带陆地字段（阵风、降水、能见度）和海况字段（浪高或涌浪）；current 单独统计。覆盖说明只是降级展示，不算达标。

## 版本与环境

| 项 | 值 |
|----|----|
| 运行 SHA | `356e6fec9431747aa42624daf8f01cff9f971f76`（`codex/shipping-hot-r1-5`） |
| 工作区 | 干净 |
| build | 在该提交上执行 `pnpm build`，产物时间 03:55:48Z，晚于提交时间 03:55:13Z |
| 环境 | Windows 10（NT 10.0.19045），Node v24.15.0，pnpm 10.30.3 |
| 隔离运行目录 | `.tmp/r1-5-1-live-2026-10-10T03-58-38-568Z`（未触碰保留库） |
| 脱敏证据 | `docs/evidence/r1-5-1-live-2026-10-10-356e6fe/`（`r1-5-1-evidence.json`、`r1-5-1-sync-live.json`、`live.log`、`gate-summary.txt`） |
| 上一轮证据（`be5f2e4`，历史） | `docs/evidence/r1-5-1-live-2026-10-10/` |

## 命令与退出码（`356e6fe`，顺序执行）

| 命令 | exit | 结果 |
|---|---|---|
| `pnpm install --frozen-lockfile` | 0 | |
| `pnpm build` | 0 | |
| `pnpm typecheck` | 0 | |
| `pnpm lint` | 0 | |
| vitest | 0 | 84 个文件，587 通过 / 3 跳过 |
| `pnpm smoke:p0-native` | 0 | |
| S7 | 0 | 151/151，gitHead 与运行 SHA 一致 |
| `pnpm test:r1-5-1-live`（第 3 次，作为证据） | 2 | BLOCKED：84 项检查，83 通过，唯一 BLOCKED 为 `coverage_port-ho-chi-minh` |
| Neat Freak `audit-inventory.sh .` | 0 | |

同一 SHA 的前两次实网运行有网络瞬断，不作为证据：`03-56-58`（巴生、林查班的 api.open-meteo.com fetch failed）、`03-57-56`（雅加达的 marine-api fetch failed）。第三次运行 19/19 个请求全部 200。

## 逐港覆盖（同步时 SQLite + 重启后 API）

| 港口 | hourly | 首 / 末 | current | 缺测 | 结果 |
|---|---|---|---|---|---|
| 蛇口、盐田、南沙、林查班、巴生、马尼拉、雅加达 | 169/169 | 2026-10-10T03:00Z / 2026-10-17T03:00Z | 1 | 0 | **PASS** |
| 胡志明（VNSGN） | 169/169 | 同上 | 1 | 浪/涌浪 169/169 | **BLOCKED** |

截断检查：八港 DB 窗口内 hourly 与 API hourlyReturned 都是 169，没有被挤掉。

## 重启前后一致性（字段级，API 对 SQLite）

在重启前后两个窗口的公共部分，按 `portId+horizon+forecastAt` 逐条比对浪、涌浪、风速、阵风、降水、能见度：八港重启前、后各 170 行（169 hourly + 1 current），字段不一致 0，API 缺行 0，DB 缺行 0。

## 浏览器（范围声明）

只核验了**页面元数据和覆盖信息**：页面能加载、文字非空、`port-weather-forecast-meta` 中的 total/hourly/current 与 API 一致、VNSGN 的海况说明已显示。**没有**逐字段核验 UI 上的数值。

## JMA

- 归档（SQLite 存储）：2 条（TC2634、TC2635），outcome=`ok`
- 关注海域活跃数：0

## VNSGN

诊断见 `docs/evidence/vnsgn-marine-coverage-diagnosis-2026-10-10.md`（只读，含方案对比）。
