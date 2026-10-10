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

- WR-O02 的「主要城市」清单**暂时保持为空**：用户 guoyong lai，Grok Bot 聊天，2026-10-10 12:21 UTC+8，原话「先保持空值」（回答「提供 WR-O02 主要城市清单还是保持为空」）。范围映射仍待办。生产配置 `deliveryMajorCities = {}`，WR-O02 线上不会触发，只由夹具验证。

## 门禁（代码提交 `aa1d12aad578f3370c2340d97deca94ba32813c3`，Windows 10 19045，Node v24.15.0，pnpm 10.30.3，顺序执行，工作区干净）

- install 0 · build 0 · typecheck 0 · lint 0 · Vitest 85 个文件 **606 通过 / 3 跳过** exit 0 · smoke:p0-native 0 · S7 exit 0（PASS，保留库未改动）· Neat Freak audit 0
- `pnpm test:r1-5-1-live`：第 1 次 exit 1（JMA `fetch failed`，偶发）；第 2 次 exit 2（Manila/Jakarta 上游偶发失败）；第 3 次 exit **2 = BLOCKED**（84 项，83 通过，唯一 BLOCKED：`coverage_port-ho-chi-minh`；JMA 存储 TC2634/TC2635）。前两次只记录，不作证据。
- 本地证据目录：`.tmp/gate-aa1d12a/`、`.tmp/r1-5-1-live-2026-10-10T04-14-00-808Z/`。
- R1.5-1 结论不变：**BLOCKED**（只剩 VNSGN 海况）。

## 第四轮修正（dots round-3 小修，2026-10-10）

1. **有效性改为白名单、缺信息不命中**（`officialAlertIneligibility`）。只有同时满足以下全部条件才算有效：官方源，`sourceStatus=healthy`，`stale=false`，`eventEligibility=true`，有 `weather` 且 `riskSource=official`，`alertState=active`，严重度合法；`expiresAt` 和 `alertExpiresAt` 如果存在，都必须能解析且晚于当前时间。下列每种情况都有反例夹具：字段缺失、未知、过期、源状态降级/失败/停用、到期时间无法解析。
2. **WR-O02 不再因为标题或正文提到城市就算覆盖。**
   - 发布国：只按信源目录对应（`officialAlertSourceCountry`：tmd→TH、bmkg→ID、jma→JP）。聚合源 `official-weather-alerts` 无法判定国家，**不命中**。发布国必须等于港口所在国。
   - 覆盖范围：只看结构化区域字段 `weather.alertRegion`，按分隔符拆开后逐项精确匹配。标题和正文只用来判断危险类型。
   - 夹具覆盖：跨国源、城市只出现在标题/正文（包括"Bangkok is not affected"）、真实覆盖区域的正例和反例、区域字段缺失、港口国家未知。
3. **面板/API 测试**（`server/services/port-weather-panel-official.test.ts`）：有效预警会出现在 `officialAlertImpacts` 里；过期、生命周期未知、已从索引消失、陈旧、源降级、已到期、属于其他港口的预警都会从结果中消失；没有预警时返回空数组。
4. **用户决定（原话）：** 用户 guoyong lai，在 Grok Bot 聊天中，2026-10-10 12:21 UTC+8，被问到"提供 WR-O02 主要城市清单还是保持为空"时回答「先保持空值」。所以 `deliveryMajorCities = {}`，WR-O02 线上不会触发。
   - **仍待办：** 把官方预警的区域名称或代码映射到城市（范围映射），本轮没做。
5. 本轮没有新增信源，没有改生产开关，GET 请求不会触发网络或 LLM（面板只计算已入库的预警）。TMD CAP 和 BMKG 的接入留到后续轮次。

## 第四轮门禁（代码提交 `2ca8ac2dbe383fd05d63ab8a5d96a068e2e685b2`，Windows 10 19045，Node v24.15.0，pnpm 10.30.3，顺序执行，工作区干净）

- install / build / typecheck / lint：均 exit 0；Vitest：86 个文件，**632 通过 / 3 跳过**，exit 0；smoke：exit 0；S7：exit 0；Neat Freak audit：exit 0。
- `pnpm test:r1-5-1-live` 共跑 3 次：第 1、2 次 exit 1（`Open-Meteo: fetch failed`，上游网络偶发，所有港口都拉取失败），只记录，不作证据；第 3 次 exit **2 = BLOCKED**（84 项检查，83 项通过，唯一 BLOCKED 是 `coverage_port-ho-chi-minh`）。
- 已入库的脱敏证据：`docs/evidence/r1-5-round4-gate-2ca8ac2/`，包括 gate-summary.txt、各步日志尾部、第 3 次运行的 r1-5-1-live-evidence.json（本地路径已替换为 <repo>/<home>）。
