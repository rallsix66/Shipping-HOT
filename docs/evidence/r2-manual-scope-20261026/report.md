# R2 人工范围调整（用户决定，2026-10-26）

- **dots**：`1792998333.225029` + `1792998442.152949`
- **写于**：2026-10-26T07:16:22.943Z / 2026-10-26  15:16:22 Asia/Shanghai
- **性质**：用户决定将确认的 **9** 源改入既有 `manualCatalog` / `checklist` / `save`；**零新 HTTP**；**day20-20261026a 未动**（worker 82336 / parent 27916 / host 15112）
- **产品代码绑定**：`f87a2626239baf049e3e0e6a9da7bd7ef4aa8c9c`
- **基线 tip（改前）**：`1cbefdfc30009e254794f6fe2d0761364b811bb6`
- **overallR2Pass**：false（不变）

## 1. 用户决定（明示）

若剩余约 8 源无法自动抓取 → 放入人工采集；同时把其他反复无法产出可用自动产品的源也改人工。本轮确认 **9** 源；其余矩阵保持自动方向；XX-A03/A04 仍属后期阶段（非抓取失败）。**证据-only 筛选，本批 0 次新源 HTTP。**

## 2. 实现（真接入，非仅文档宣称）

复用既有路径：

1. `server/intel/manual-catalog.ts` — 追加 9 条（含官方入口 HTTPS URL、focus 说明人工必填字段 / 许可 / checked_empty / 失败处理）
2. `server/database/migrations/030-manual-scope-r2-20261026.ts` — 增量种子（`ON CONFLICT DO NOTHING`）；`index.ts` 注册
3. `manualChecklist` / `manualSubmit` — 自动读 catalog；提交强制 `https:` 且 hostname ∈ catalog.urls；`checked_empty` 保留；不发明第二套采集框架
4. `manual.test.ts` — 旧库手工源计数 `40 → 49`；断言 `intel:manual:my-p02` / `cn-p02`
5. `html-index-candidates.ts` — MY-P03 注释：禁用候选保留离线测试，本轮所有权改人工

约束：未知字段保持未知；不绕过 TLS/DNS；人工录入 **不是** 跳过校验的裸 HTTP。

## 3. Manual 9（可用性）

| ID | 入口 | 接线 | 说明 |
| --- | --- | --- | --- |
| CN-P02 | `https://www.sz.msa.gov.cn/` | **已接入** | HTTPS entry present; checklist/submit host-allowlist = www.sz.msa.gov.cn; metadata-only; no invented dates. |
| VN-P01 | `https://vimawa.gov.vn/vi/thong-bao-hang-hai` | **已接入** | HTTPS entry; host=vimawa.gov.vn; date often absent → leave unknown; TBHH id not a date. |
| MY-P03 | `https://www.northport.com.my/np/page-announcements.html` | **已接入** | HTTPS entry; host=www.northport.com.my; disabled htmlIndexCandidate retained offline; stop auto this round. |
| MY-L01 | `https://www.pos.com.my/service-update` | **已接入** | HTTPS entry; host=www.pos.com.my; no invented slug when card lacks href. |
| PH-P01 | `https://www.ppa.com.ph/content/ppa-helpdesk-advisory`<br>`https://www.ppa.com.ph/ppa-port-news` | **已接入** | HTTPS entries; host=www.ppa.com.ph; do NOT install CA / disable TLS; prior BLOCKED TLS leaf preserved. |
| PH-W01 | `https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin` | **已接入** | User chooses manual ownership; historical explicit-empty auto-recognize + limited R2-4 OK retained; NOT rewrite as parse-never-succeeded. |
| PH-W02 | `https://www.pagasa.dost.gov.ph/weather/weather-advisory` | **已接入** | Same ownership decision as PH-W01; historical empty-state auto-recognize retained. |
| XX-F01 | `https://seller-my.tiktok.com/university/essay?knowledge_id=4293090978809617` | **已接入（访问风险→可能待接入）** | Catalog+migration+checklist wired; human may hit login/JS → degrade to 待接入 if page cannot be opened; no claim usable from docs alone for content. |
| MY-P02 | `https://www.westportsholdings.com/category/press-release/feed/`<br>`https://www.westportsholdings.com/` | **已接入** | NOT tech-cannot-fetch: 200s on 10/13,10/15,10/25; 7/10 empty titles; 3 valid newest 2025-08-01; keep R2-5 limited PASS + R2-4 STALE. Empty titles must not be forged valid. |

- **XX-F01**：catalog/migration/checklist **已接线**；若人工打不开登录/JS 页，诚实标为 **待接入（访问）**，不凭文档宣称可用内容。
- 其余 8：HTTPS 入口 + host allowlist → checklist/submit/checked_empty **可用**（仍 metadata-only；不等于自动字段 PASS）。

## 4. Auto 30（现有证据覆盖口径）

矩阵 41 − 后期 XX-A03/A04 − 人工 9 = **30**。

`CN-P01`, `CN-W01`, `CN-W02`, `CN-T01`, `CN-T02`, `VN-P03`, `VN-W01`, `VN-T01`, `VN-D01`, `TH-W01`, `TH-C01`, `TH-C02`, `MY-W01`, `MY-C01`, `MY-T01`, `ID-W01`, `ID-W02`, `ID-T01`, `ID-T02`, `PH-C01`, `PH-M01`, `XX-W01`, `XX-W02`, `XX-K01`, `XX-K02`, `XX-K03`, `XX-M01`, `XX-M03`, `XX-A01`, `XX-A02`

| 口径 | 值 | 读法 |
| --- | --- | --- |
| 自动方向分母 | **30** | 本轮用户决定后的自动计划分母 |
| 历史 R2-4 OK 落在该 30 | **30/30** | 现有证据覆盖；**不是**新一轮全量验收 PASS |
| 其中资讯历史字段 PASS | **25/25** | = 原 R2-5 26 去掉改人工的 MY-P02 |
| 数值 5 | 另列 XX-W01/XX-A01/XX-A02/ID-W02/XX-W02 | 不混进资讯 25；生产挂载率 NOT_CLAIMED |
| 历史 R2-4 / R2-5 | **32/39** / **26/34** | **保留可追溯**；不把移出自动伪装成原 34/34 PASS |
| overallR2Pass | **false** | 不变 |

## 5. 超出原 8 的额外人工：MY-P02

- **不是**「技术不能抓」：10/13、10/15、10/25 均有 200；但 7/10 标题空、3 条有效最新仍 2025-08-01；内容可用性反复未解决。
- **保留**原 R2-5 限定 PASS（3 条有效 RSS 字段回放）与 R2-4 STALE。
- 与「未接线/禁用」「曾超时但已恢复（如 PH-C01/VN-D01）」区分——**未**因单次超时降权其他源。
- 本轮 **无** 第 10 个额外人工源。

## 6. day20 / HTTP / 非目标

- day20 RUNNING 未重启、未删锁、未扩源、未热补丁、未续 day19。
- 本批新源 HTTP 次数：**0**。
- 未改系统设置 / CA / 生产启用 / merge / deploy / force。

## 7. 机器可读

见同目录 [scope.json](scope.json)。

## 8. 全量门禁

- install / build / typecheck / lint / Vitest：**PASS**
- Vitest：2055 passed / 9 skipped / 161 files
- S7 harness：NOT_REQUIRED（无 shell/route 行为变更；仅 EXPECTED_SCHEMA_VERSION 29→30）
- 日志目录：.tmp/gate-manual-scope-20261026/
- [gate.public.json](gate.public.json)
