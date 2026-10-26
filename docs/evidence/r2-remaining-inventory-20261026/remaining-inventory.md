# R2 剩余清单与数值口径纠正（盘点 only）

- **dots**：`1792993692.018489`（UTC 2026-10-26T05:48:12.018489Z / Asia/Shanghai 2026-10-26 13:48:12.018）
- **性质**：只读盘点 + 文档口径纠正；**零新网络**；未启动额外信源/任务/采样；**day20-20261026a（PID 82336）未动**
- **基线 tip（文档前）**：`f9d61698c74c133a33e83d6e9bfeafaf11b2f28d`；**产品门禁**绑定 `f87a2626239baf049e3e0e6a9da7bd7ef4aa8c9c`
- **overallR2Pass**：false（不变）

## 1. 数值口径纠正（必须）

先前口头/摘要里的「数值生成 3/5」「还缺两个生产挂载」**不准确**。

| 口径 | 正确读法 |
| --- | --- |
| `mapping.measuredCoverage.numericFieldsSeparate` **3/5** | **历史有限归一化字段诊断**分子（XX-W01 / XX-A01 / XX-A02），**不是**生产 attach rate |
| ID-W02 | 已有 **完整原件离线 parse** 证据（另列；`ProductionIntegrationRate=NOT_CLAIMED`） |
| XX-W02 | 已有 **forecast + specifications 有限字段** 离线证据（另列；非生产 sync 挂载账本） |
| 禁止 | 简单说「还缺两个生产挂载」；禁止把两项离线证据抹成空白；禁止发明原合同外新门槛；禁止改写成 blanket **5/5 生产通过** |

### 五项各证据类型 / 当前限制

| ID | 证据类型 | 是否计入历史 3/5 | 当前限制 |
| --- | --- | --- | --- |
| XX-W01 | `PASS_LIMITED_STORED_REAL_DIAGNOSTIC` | 是 | 历史有限归一化诊断（target TC list/IDs）；非保留 raw JSON 生产回放；非生产挂载率 |
| XX-A01 | `PASS_LIMITED_STORED_REAL_DIAGNOSTIC` | 是 | 陆地点风阵/降水/能见度时间戳诊断；同上限制 |
| XX-A02 | `PASS_LIMITED_STORED_REAL_DIAGNOSTIC` | 是 | 浪涌预报字段诊断（VNSGN 原项仍缺）；同上限制 |
| ID-W02 | `COMPLETE_ORIGINAL_OFFLINE_PARSE_LIMITED_ACCEPTED` | **否（另列）** | 完整原件离线 parse 已接受；**不**等于生产 DB/Provider 激活或持续可用 |
| XX-W02 | `PASS_LIMITED_OFFLINE_FORECAST_AND_SPECIFICATIONS` | **否（另列）** | 双 TC forecast+specifications 离线字段已核；**不**等于生产 sync 集成 / 连续运行 |

历史分子 **3/5 数字本身保留**（不假装从未发生）；仅纠正其**语义**并补齐五项分列。

## 2. 当前 R2 剩余清单

| 项 | 状态 | 要点 |
| --- | --- | --- |
| R2-1/2/3 | 已接受 | **不重做** |
| R2-4 | **32/39**（达最小 32） | 残差非 OK：CN-P02 PARTIAL、VN-P01 PARTIAL、MY-P02 STALE、MY-P03 PARTIAL、MY-L01 PARTIAL、PH-P01 BLOCKED、XX-F01 NOT_RUN |
| R2-5 | **26/34**，剩余 **8** | CN-P02、VN-P01、MY-P03、MY-L01、PH-P01、PH-W01、PH-W02、XX-F01 |
| R2-6/7 限定部分 | 已接受限定 | **不重做**已接受部分 |
| R2-8 | 19 源 day20 **运行中 ≠** 全 P1 连续验收完成 | day19=ATTEMPTED_INCOMPLETE（历史）；day20=24h-19 运行至约 2026-10-27 10:58 Asia/Shanghai，**leave alone** |
| 仍需 | 既有适用集成门禁 / 独立审查 / 状态收口 | 不新开普遍采样 |
| 范围外 | Mobile 延期；R1.5 历史重做；R3；go-live | — |

## 3. RO 对照：day20 近 19 源 vs 全 P1

**day20 已覆盖（19）**：TH-W01、ID-W01、CN-T02、TH-C01、PH-C01、CN-P01、TH-C02、VN-P03、VN-T01、ID-T01、XX-K03、ID-T02、VN-D01、XX-K02、XX-K01、MY-C01、MY-T01、PH-M01、XX-M03

**公开 P1 39 中未进 day20（20）**：CN-P02、CN-W01、CN-W02、CN-T01、VN-P01、VN-W01、MY-P02、MY-P03、MY-W01、MY-L01、ID-W02、PH-P01、PH-W01、PH-W02、XX-W01、XX-W02、XX-M01、XX-A01、XX-A02、XX-F01

| 已覆盖 | 仍不覆盖 |
| --- | --- |
| profile `24h-19` 近 19 源连续观察（盘点时 worker PID 82336 存活；首轮历史磁盘可见 19 ok_items） | 全 39 源 P1 连续 24h 验收 |
| | 数值 5 项生产挂载/集成 |
| | R2-5 剩余 8 项字段回放缺口 |
| | 以 observe 代替资格门禁或 overallR2Pass |
| | 默认 off 的生产启用 |

**既有 attach/集成限制（盘点）**：Intel 默认关；数值 3/5 诊断≠挂载率；ID-W02/XX-W02 离线证据 `ProductionIntegrationRate=NOT_CLAIMED`；day20 多源 `persistence=disallowed`（metadata-only）。

## 4. 证据指针

- 本清单 JSON：[remaining-inventory.json](remaining-inventory.json)
- 矩阵：[../r2-current-source-matrix-2026-10-14/mapping.json](../r2-current-source-matrix-2026-10-14/mapping.json)
- day20 host 只读盘点目录（未改）：`D:/try one/Shipping HOT/.tmp/day20-20261026a-host/`（`start-identity.json` / `plan.stdout.txt` / `part-a-report.json`）

**未合并 / 未部署 / 未 force；未碰 main dirty、D:/wt-s1~s5、D:/wt-diag-3d42100、Junctions。**

## Addendum — batch convergence（dots 1792994131 / 3982 / 4253）

- R2-8 **coverage-diff** 口径已落盘：不强制 39 同窗 / 不强制每加源全量重跑 / 不拼接 day19+day20；详见 [../r2-batch-convergence-20261026/r2-8-coverage-diff.md](../r2-batch-convergence-20261026/r2-8-coverage-diff.md)。
- 剩余 8 本批分类：**8/8 EXTERNAL_MISSING_MATERIALS**；可修代码缺陷 **0**；下一 URL 预算 **none**。
- 完整批次报告：[../r2-batch-convergence-20261026/report.md](../r2-batch-convergence-20261026/report.md)。
