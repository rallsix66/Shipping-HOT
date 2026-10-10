# R1.5-2 / R1.5-3 官方预警规则验收（2026-10-10）

依据：9/29 主方案 §4.8（影响规则表最后两行、「潜在影响和已实施要分开（强制）」）、§6 R1.5 验收 R1.5-2 / R1.5-3；`AGENTS.md`。

## 本轮验收清单

| # | 要求（出处） | 实现 / 证据 | 结果 |
|---|---|---|---|
| 1 | 每条天气规则都有命中和不命中夹具（R1.5-2） | WR-S01..S05：`server/services/weather-impact-engine.test.ts`（已有）；WR-O01/WR-O02：`server/services/official-alert-impact.test.ts`（新增） | 夹具 PASS |
| 2 | 命中后状态为「潜在」、provenance `system`、带规则 ID 和输入值（R1.5-2） | 所有命中 `status=potential`、`provenance=system`；WR-O 系列 `inputValues` 含 `officialSourceId / officialAlertId / officialSeverity`，WR-O02 另含 `matchedHazard / matchedCity` | 夹具 PASS |
| 3 | 「任意：命中官方预警 → 取官方等级，以官方原文为准（🏛）」（§4.8） | **WR-O01**：与港口关联的官方预警（`relatedPortIds`），等级取官方，`summaryZh=以官方原文为准：<原标题>`，原文挂在 `officialBasis`（provenance `official`） | 夹具 PASS |
| 4 | 「派送/地区：官方暴雨/洪水/热带气旋预警且覆盖主要城市 → 取官方等级，派送可能受影响」（§4.8） | **WR-O02**：危险类型关键词（暴雨/洪水/热带气旋，中/英/印尼/越/泰）+ 主要城市匹配 | 夹具 PASS；**生产配置不触发**（见下） |
| 5 | 只用当前有效的官方预警 | 非官方源、`stale`、`eventEligibility=false`、`alertState=expired/unknown`、`expiresAt` 已过 → 不命中（逐项夹具） | 夹具 PASS |
| 6 | 规则永远不会产生「已实施」（R1.5-3） | 预警原文写「港口关闭/已停工/已封港」也只产出 `potential`；极端输入下 7 条规则全部只产出 `potential`；守卫函数拒绝伪造的 `implemented` | 夹具 PASS |
| 7 | 判断与预报数值、官方预警分开展示（§4.8） | 面板 API 新增 `officialAlertImpacts`（与 `officialAlerts`、`impacts` 分开）；本轮**未改 UI** | API 字段已加；UI 未做 |
| 8 | 按信源目录更新官方预警源（TMD 只留 CAP；新增 MetMalaysia API、NCHMF、PAGASA） | **未实现**（新 Provider 需要按 AGENTS.md 单独确认） | NOT_RUN |

## 真实官方证据（与夹具分开报告）

- **没有真实官方预警样本跑过 WR-O01/WR-O02。** 现有 TMD/BMKG/JMA 适配器仍为 `live_pending`、默认关闭；CN/MY/PH/VN 官方预警源未接入。
- WR-O02 的「主要城市」清单：方案没有列出，本轮又不做末端城市（方案 §245），因此生产配置 `deliveryMajorCities` 为空，**线上不会触发**，需要你确认清单。
- 没有使用任何 VNSGN 外海格点或推测数据。

## 状态

- R1.5-2：**PASS（夹具/测试范围）**；真实官方预警证据 **NOT_RUN**。
- R1.5-3：**PASS（测试）**。

## 用户决定（2026-10-10）

- WR-O02 的「主要城市」清单**暂时保持为空**（用户决定）。生产配置 `deliveryMajorCities = {}`，WR-O02 线上不会触发，只由夹具验证。

## 门禁（代码提交 `aa1d12aad578f3370c2340d97deca94ba32813c3`，Windows 10 19045，Node v24.15.0，pnpm 10.30.3，顺序执行，工作区干净）

- install 0 · build 0 · typecheck 0 · lint 0 · Vitest 85 个文件 **606 通过 / 3 跳过** exit 0 · smoke:p0-native 0 · S7 exit 0（PASS，保留库未改动）· Neat Freak audit 0
- `pnpm test:r1-5-1-live`：第 1 次 exit 1（JMA `fetch failed`，偶发）；第 2 次 exit 2（Manila/Jakarta 上游偶发失败）；第 3 次 exit **2 = BLOCKED**（84 项，83 通过，唯一 BLOCKED：`coverage_port-ho-chi-minh`；JMA 存储 TC2634/TC2635）。前两次只记录，不作证据。
- 本地证据目录：`.tmp/gate-aa1d12a/`、`.tmp/r1-5-1-live-2026-10-10T04-14-00-808Z/`。
- R1.5-1 结论不变：**BLOCKED**（只剩 VNSGN 海况）。
