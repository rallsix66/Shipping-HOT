# R2-4 PAGASA PH-W01/PH-W02 限定核验（dots 1792977003.407069）

Baseline `fe8b2f8c9ec449dff043e6ce3ba91c0a5691ffd9`. Branch `codex/shipping-hot-r2-4-gapfill-20261025`.
独占 worktree：`D:/try one/Shipping HOT/.tmp/worktrees/r2-4-gapfill-20261025`。
**未**重做 JMA / PPA。计数冻结 **30/39**、**25/34**；`overallR2Pass=false`；PPA 仍 BLOCKED。执行器**未**自行抬升 OK。

## HTTP 账本（本轮新鲜，cap=6）

| # | URL | status | counted |
| --- | --- | --- | --- |
| 1 | https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin | 200 | yes |
| 2 | https://www.pagasa.dost.gov.ph/weather/weather-advisory | 200 | yes |
| — | https://pubfiles.pagasa.dost.gov.ph/tamss/weather/bulletin/TCB%2317_rosal.pdf | DNS `blocked_address` (198.18.0.141) | **no HTTP**（安全拒绝后停止；无重试/无绕过） |

used=**2**/6；redirects=0；retries=0。未混用旧轮 `r2-4-gapfill-20261025` budget。

## PH-W01（Severe Weather Bulletin）

- 入口：`secureFetchArticle` + DNS/public/TLS 链 → **CAPTURED** HTTP 200，141029 bytes，sha256 `b5ecb77a40ada689...`
- **法定空状态原文**：`No Active Tropical Cyclone within the Philippine Area of Responsibility`（容器 h3）
- 身份 / 发布时间 / 时区 / 有效期 / 更新撤销：**均 null**（空状态，无现行公报正文）
- 稳定入口链：同上 URL；**未**用 TC Advisory 替代
- Archive 区链出 17 个官方 `pubfiles.pagasa.dost.gov.ph` PDF（TCB#1..#17_rosal）；最新 `TCB#17_rosal.pdf`
- 最新归档 PDF：DNS 分到 `198.18.0.141` → `blocked_address` → **停止**，未发 GET
- **不**把 200 壳 / 归档链当作现行可用公报或新风险事件
- 公开字段：[`PH-W01-fields.public.json`](./PH-W01-fields.public.json)

## PH-W02（Weather Advisory）

- 入口：**CAPTURED** HTTP 200，131818 bytes，sha256 `8ac1546c1681d5b6...`
- **法定空状态原文**：`As of today, there is no Weather Advisory issued.`
- 身份 / 时间 / PDF：**无**；页面无可确认 PDF 链接（非 iframe 产品正文）
- 与 PH-W01 **未**共用同一空状态充当两套有效字段
- 公开字段：[`PH-W02-fields.public.json`](./PH-W02-fields.public.json)

## day19 观察（只读，非新开观测）

- 路径：`r2-compat/.tmp/r2-intel-observe-day19-20261025a`（profile `24h-19`）
- 计划窗：`2026-10-25T03:57:37.686Z` → **`2026-10-26T03:57:37.686Z`（= 2026-10-26 11:57:37 Asia/Shanghai）**
- 检查时（2026-10-26 09:21:07 Asia/Shanghai）：**尚未到点**；**未**宣称 24h 通过
- 运行中？**否**。末事件 seq=799 @ `2026-10-25T07:45:29.905Z`（`job_result` success）后无新事件 ≈ 启动后 3.8h **自然异常停**；仅报既有日志事实
- 调度记录仍在（末批 `nextSyncAt` 如 `2026-10-25T08:15:28.208Z`）；lock 文件在、pid 29736 **未在跑**；未改 lock/DB/config、未重启

## 门禁

纯证据轮：JSON 解析、链接存在、`git diff --check`。无生产代码改动；未跑全量 Vitest/build（无 code delta）。

## 给 dots 的裁定材料（执行器不抬升）

1. PH-W01 / PH-W02 入口可达恢复（相对历史 403/blocked），但快照为**法定空状态**
2. 现行可用正文/编号/发布时间仍缺；归档 PDF 主机 DNS 被拦
3. 计数请保持 **30/39** & **25/34** 直至 dots 另裁
