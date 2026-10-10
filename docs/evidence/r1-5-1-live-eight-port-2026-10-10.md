# R1.5-1 八港实网验收证据（2026-10-10，复审修复后）

> 结论：**BLOCKED**（harness 已修复；业务验收未达 9/29 主方案 R1.5-1 标准）。不合并、不部署。

## 版本绑定

| 项 | 值 |
|----|----|
| 代码提交（运行 SHA） | `be5f2e4b14258404f769eb68ff07130cc2361732`（分支 `codex/shipping-hot-r1-5`） |
| 工作区 | 运行时干净（`git status --porcelain` 为空） |
| build 来源 | 在该提交上执行 `pnpm build`；`dist/output/server/index.mjs` 生成于 2026-10-10T03:39:01Z，晚于提交时间 03:38:31Z |
| Node | v24.15.0 |
| 隔离运行目录 | `.tmp/r1-5-1-live-2026-10-10T03-40-07-858Z`（未触碰保留库） |
| 脱敏原始证据 | `docs/evidence/r1-5-1-live-2026-10-10/r1-5-1-evidence.json`、`r1-5-1-sync-live.json`、`live.log`、`gate-summary.txt` |

本文件与 `docs/status.md` 在其后的纯文档提交中更新；代码与证据绑定以上 SHA。

## 命令与退出码（全部在 `be5f2e4` 上顺序执行）

| 命令 | exit | 结果 |
|------|------|------|
| `pnpm install --frozen-lockfile` | 0 | |
| `pnpm build` | 0 | |
| `pnpm typecheck` | 0 | |
| `pnpm lint` | 0 | |
| `pnpm exec vitest run -c vitest.config.ts` | 0 | 83 files，572 passed / 3 skipped |
| `pnpm smoke:p0-native` | 0 | |
| `node scripts/e2e-s7-integrated.mjs` | 0 | 151/151，Flow A 16 / B 22 / C 62，外部请求 0，gitHead = 运行 SHA |
| `pnpm test:r1-5-1-live` | **2** | **BLOCKED**（68 项检查，60 通过；harness 失败 0，前置缺失 0，业务 BLOCKED 8） |
| `bash scripts/audit-inventory.sh .`（Neat Freak） | 0 | |

## 验收口径（9/29 主方案 R1.5-1）

8 个港口都要有 7 天的海况和陆地预报。窗口 `[now−1h, now+7d]`，只计 `hourly`；网格内每个 UTC 整点必须恰好出现一次（唯一、首尾都在、无缺口），并带陆地字段（阵风、降水、能见度）和海况字段（浪高或涌浪）。`current` 单独统计，不参与计数。覆盖说明（`marineCoverageNote`）只是降级展示，**不算**达标。

## 结果

### 已验证子链路

| 子链路 | 状态 |
|--------|------|
| 种子 → 隔离库 | VERIFIED |
| 实网 Open-Meteo → SQLite（egress：marine 8×200，weather 8×200，JMA 3×200） | VERIFIED |
| 八港重启后 API 持久化 | VERIFIED |
| API 未被截断（DB 窗口内 hourly = API hourlyReturned） | VERIFIED（八港均 165 = 165） |
| 浏览器八港 `/ports/:id`，逐港断言 `port-weather-forecast-meta` 与重启后 API 一致 | VERIFIED |
| JMA 实网归档 | VERIFIED（outcome=`ok`） |
| 夹具浏览器 S7（同 SHA、全量检查集） | VERIFIED |

### 逐港七天覆盖

| 港口 | 窗口内 hourly / 应有 | 首 / 末 | current | 结果 |
|------|------|------|------|------|
| 八港（蛇口、盐田、南沙、林查班、巴生、马尼拉、雅加达、胡志明） | 165 / 169 | 2026-10-10T03:00Z / 2026-10-16T23:00Z | 1 | **BLOCKED**：`window_end_covered`、`no_missing_hours`（2026-10-17T00:00–03:00Z 缺失） |
| 胡志明（VNSGN）另有 | 浪/涌浪 165/165 缺测 | | | **BLOCKED**：`marine_wave_or_swell_present` |

原因：Open-Meteo `forecast_days=7` 按 UTC 自然日返回，到第 7 天 23:00 为止，覆盖不到滚动的 `now+7d`。之前的 `hourly ≥ 140` 判定掩盖了这一点。

截断检查：面板读取是 `ORDER BY forecast_at ASC LIMIT 172`。每港目前只存 168 条 hourly + 1 条 current，所以本次没有挤掉未来小时（已逐港核对）。但如果把 `forecast_days` 加到 8，或者库里留着过去的小时，这个上限就会把未来预报挤出去，所以两处要一起改。

### JMA（分开报告）

- 归档（SQLite 存储）：**2** 条（`tc-jma-TC2634`、`tc-jma-TC2635`），outcome=`ok`
- 关注海域活跃数：**0**（面板可见性规则：关注海域 / 1000 km）

## 最小后续（需批准，本批未实现）

1. 评估 `forecast_days=8`，同时把港口面板改为按窗口读取，不再取最早 N 条。
2. VNSGN：评估近海格点或获批替代源。本批未改 `cell_selection=sea`、坐标和数据源。

## 同日其他运行（不作为证据）

- `03-33-53`：南沙 0 行；`03-37-32`：南沙、巴生 0 行。原因是 Open-Meteo 单港请求失败，`weather-sync` 容忍了这些失败，job 仍报 success。现已加 egress 记录，并把 0 行港口判为 BLOCKED。
- `03-35-08` / `03-35-31`：两次并发误启动（同一端口），作废。
