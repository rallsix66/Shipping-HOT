# DeepSeek 试点 Search 候选核验（2026-10-24）

> **目的**：判断已有 Search 第 9、10 次结果「搜到的是否有用」——**不是**再测接口。
> **数据源**（只读、本机未入库）：`pilot-attempt-ledger.sqlite3` 中 `result_summary_json`；回执与 `ninth-run-evidence.json` / `mpa-followup-closeout.json` 交叉一致。
> **无**新 Search/Fetch/DNS/HTTP（**例外**：PM Notice 54 单条只读 HTTPS 核验见 [`notice-54-verification-2026-10-24/README.md`](notice-54-verification-2026-10-24/README.md)）；**无**密钥或原始响应入仓。

关联试点收口：[`../r2-deepseek-pilot-live-2026-10-24/README.md`](../r2-deepseek-pilot-live-2026-10-24/README.md)

## 回执核对

| Search | operation_key | receipt_id | ledger status | 保存候选数 |
|--------|---------------|------------|---------------|------------|
| 第 9 次 | `search:3fc560…` | `676978c3-52f4-4055-9e7d-a70f216bdba0` | succeeded | 10 |
| 第 10 次（账本第 11 行，legacy 键） | `search:623d1734…` | `94bb33fe-515c-4d0f-97bd-1b335830d742` | succeeded | 10 |

明细：`candidates.json`、`candidates.csv`；去重机器可读：`dedupe-summary.json`。

## 去重规则与结果

- **规则**：仅对 URL 做 **trim** 后 **逐字符相等** 判重；**不**合并 http/https、www/非 www、路径变体、query/fragment、尾斜杠差异。
- **不用** `titleUrlHash` 代替 URL 去重（hash 同时依赖标题与 URL）。

| 指标 | 数值 |
|------|------|
| Search 第 9 次保存候选 | 10 |
| Search 第 10 次保存候选 | 10 |
| 第 9 次内部重复 URL | 0 |
| 第 10 次内部重复 URL | 0 |
| 两次之间重复 URL | **2** |
| 合并后 **唯一 URL** | **18** |

**跨次重复 URL（各出现 2 次，标题一致，无冲突）**

1. `https://www.mpa.gov.sg/media-centre/details/port-marine-circular-no-10-of-2026-submission-of-accurate-information-for-vessel-port-calls-and-port-clearance`
2. `https://www.mpa.gov.sg/media-centre/details/port-marine-notice-no.-54-of-2026---navigation--restrictions-under-the-rts-link`

**同 URL 不同标题**：0 条（`sameUrlDifferentTitleConflicts` 为空）。

**疑似同题不同 URL（未强并）**：见 `dedupe-summary.json` → `suspectedTopicOverlapNotMerged`。其中 **PMC 03 与 PMC 10** 仅为路径 slug 形态相近，**不能**仅凭相似判为同题或重复；**Shipping Circular** 与 **Port Marine Circular/Notice** 文书类型亦不同。

## 分类统计（标题 + URL；Notice 54 另见单条 HTTPS 核验）

| 维度 | 数量 | 说明 |
|------|------|------|
| 主机为 `www.mpa.gov.sg` | **11** / 18 | 仅 URL 主机匹配；Notice 54 精确 URL 已访问但 **404** |
| **非 MPA 主机** | **7** / 18 | **6** 条贸易媒体 + **1** 条中文聚合页（`wap.sol.com.cn`）；**不**与 MPA 11 条重复计数 |
| 页面类型 `specific_notice_or_circular` | **6** | 见下「六种官方详情文书类型」 |
| 页面类型 `news_report` | 7 | 与上「7 条非 MPA」一致（含 1 条中文页） |
| 页面类型 `section_or_program_page` | 3 | 栏目/项目说明页 |
| 页面类型 `listing_hub` | 1 | Media Centre 列表 |
| 页面类型 `pdf_download` | 1 | MPA API PDF 链（文件名含 `nov23`；标题含 **2021** → 待核实/可能历史） |

**六种官方详情链接（不宜统称 PM Notice/PMC）**

| 文书类型 | 条数 | 候选 URL 特征 |
|----------|------|----------------|
| Port Marine **Notice** | 3 | PM Notice 54、107、117 |
| Port Marine **Circular** | 2 | PMC 03、PMC 10（slug 不同，**非**重复） |
| **Shipping Circular** | 1 | 标题 `SHIPPING CIRCULAR NO. 7 of 2026`（MEPC 84 决议，偏合规/行政） |

**业务分类（`businessClass`）**

| 分类 | 数量 |
|------|------|
| `declaration_compliance` | 4 |
| `port_ops_disruption_or_restriction` | 4 |
| `general_ops_hazard_or_safety_advisory` | 4 |
| `general_admin_or_program_info` | 3 |
| `uncertain` | 2 |
| `unrelated_or_low_signal` | 1 |

**时效标注（元数据层，非读页结论）**

- **PM Notice 107**（ICA CREW 维护 **2026-09-08 / 09-15**）：相对盘点日 **2026-10-24** 维护窗口已过 → **移出当前风险优先项**；可保留为「标题日期 vs 盘点日」历史时效样例。
- 标题或路径含 **2021**、**nov23** 等旧线索（如 `notmarinov23.pdf` / 91P/2021）：标记 **待核实 / 可能历史内容**；**不**把「作业相关」标题词直接当作 **当前有效风险**。

`providerDate` 一律视为 **提供方日期 / 未核验**，**不是** `publishedAt` 或事件生效时间。

## 「有没有用」——结论摘要

- **有用的一面**：18 个唯一 URL 中含 **11 条 MPA 官方主机**链接，其中 **6 条**为具体 **Notice/Circular 详情路径**（见上表分类型），与新加坡港口情报 **可能相关**，但多数仍缺正文；**PMC 03 与 PMC 10 不是同题重复**。
- **非 MPA**：**7 条**（**6** 贸易媒体 + **1** 中文聚合），对停航/拥堵类情报 **信号弱或间接**。
- **合规 vs 作业中断**：申报/船籍/port clearance 类 **PMC** **≠** 停港或延误事件（`declaration_compliance`）。
- Search 第 10 次 `need_content=true` **不**证明已有正文；`excerpt_only` **不是**网站许可。

## PM Notice 54（RTS Link）单条核验

- 精确 URL 见 [`notice-54-verification-2026-10-24/README.md`](notice-54-verification-2026-10-24/README.md)。
- **结论 C**：信息不足，保持未确认（官方 **404**，未取得正文；**不是** DeepSeek Fetch 成功）。

## 其余待读（当前优先，本片未联网）

| 优先级 | URL | 理由 |
|--------|-----|------|
| 1 | `https://www.mpa.gov.sg/media-centre/details/port-marine-circular-no-10-of-2026-submission-of-accurate-information-for-vessel-port-calls-and-port-clearance` | 官方 **PMC 10**；两次 Search 命中；试点 Fetch **404** — 需另授权读页，**不能**假设 DeepSeek Fetch 可用。 |
| 2 | `https://www.mpa.gov.sg/media-centre/details/port-marine-notice-117-of-2026-deployment-of-seabed-acoustic-doppler-current-profilers-adcp-at-sudong-island` | 标题为 Sudong 岛 ADCP 部署；可能局部作业/通航提示，**未读页**。 |

**已降级（历史/过期窗口，不作当前风险优先）**

- PM Notice **107**（ICA CREW 2026-09-08/15 维护）— 见上时效标注。

## 当前证据能证明 / 不能证明

**能证明（在元数据层 + Notice 54 单次 HTTPS）**

- 两次 Search 各 10 条；回执与 ledger 一致；精确 URL 去重 **18**；跨次重复 **2**。
- Notice 54 **精确 URL** 在 **2026-10-24** 只读访问为 MPA 官方 **404**（见子目录证据）。

**不能证明**

- 除 Notice 54 的 404 外，其它候选原页、生效期、范围、是否仍有效。
- PMC 03/10 slug 差异下的同题关系；第三方新闻与 MPA 原文一致性与 `wap.sol.com.cn` 相关性。
- 任何 **实际** 全港停港、拥堵或延误（含将 RTS Link 限制外推全港）。

## 文件

| 文件 | 内容 |
|------|------|
| `dedupe-summary.json` | 去重计数、跨次重复、疑似同题、分类聚合 |
| `candidates.json` | 18 条唯一 URL（含分类、文书类型与限制） |
| `candidates.csv` | 同上（表格） |
| `notice-54-verification-2026-10-24/` | PM Notice 54 单条业务核验（结论 C） |

生成方法：本机 worktree `.tmp/build-candidate-review-artifacts.mjs`（**未提交**；只读 ledger，可复跑）。

**R2 计数**：本片 **不** 增加 R2-4/R2-5 资格或 qualification 计数。
