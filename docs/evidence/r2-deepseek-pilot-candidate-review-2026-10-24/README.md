# DeepSeek 试点 Search 候选核验（2026-10-24）

> **目的**：判断已有 Search 第 9、10 次结果「搜到的是否有用」——**不是**再测接口。
> **数据源**（只读、本机未入库）：`pilot-attempt-ledger.sqlite3` 中 `result_summary_json`；回执与 `ninth-run-evidence.json` / `mpa-followup-closeout.json` 交叉一致。
> **无**新 Search/Fetch/DNS/HTTP；**无**正文、密钥或原始响应入仓。

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

**疑似同题不同 URL（未强并）**：见 `dedupe-summary.json` → `suspectedTopicOverlapNotMerged`（含第三方重复报道、两条 Manifold haze 文、PMC 03 与 PMC 10 不同 slug）。

## 分类统计（仅依据标题 + URL，未读原页）

| 维度 | 数量 | 说明 |
|------|------|------|
| 主机为 `www.mpa.gov.sg` | **11** / 18 | 仅 URL 主机匹配项目语境下的 MPA 官方域；**未**读页核实 |
| 页面类型 `specific_notice_or_circular` | **6** | 含 PM Notice / PMC 详情路径或标题模式 |
| 页面类型 `news_report` | 7 | 第三方贸易媒体 |
| 页面类型 `section_or_program_page` | 3 | 栏目/项目说明页 |
| 页面类型 `listing_hub` | 1 | Media Centre 列表 |
| 页面类型 `pdf_download` | 1 | MPA API PDF 链 |

**业务分类（`businessClass`）**

| 分类 | 数量 |
|------|------|
| `declaration_compliance` | 4 |
| `port_ops_disruption_or_restriction` | 4 |
| `general_ops_hazard_or_safety_advisory` | 4 |
| `general_admin_or_program_info` | 3 |
| `uncertain` | 2 |
| `unrelated_or_low_signal` | 1 |

`providerDate` 一律视为 **提供方日期 / 未核验**，**不是** `publishedAt` 或事件生效时间。

## 「有没有用」——结论摘要

- **有用的一面**：两次 Search 在 **18 个唯一 URL** 中带回 **11 条 MPA 官方主机**链接，其中 **6 条**像具体 PM Notice/PMC **详情页**（含航行限制、系统维护、设备部署、合规 circular 等），与新加坡港口风险情报 **可能相关**，但均需读原页才能确认影响范围与时效。
- **噪声 / 间接**：7 条第三方新闻（多为合规提醒、haze、bunkering 规则转述）、1 条中文聚合页（`wap.sol.com.cn`）、若干 **栏目/列表/ PDF 索引** 页 — 对「港口停航/拥堵/中断」类情报 **信号弱或间接**。
- **不能**把「申报/虚假船籍/port clearance 数据」类 circular **等同于**停港或延误事件；归类为 **合规与申报**（`declaration_compliance` / `compliance_context_not_operational_closure`）。
- Search 第 10 次虽带 `need_content=true`，ledger **仍只有** trim 元数据；**不**证明已有可用正文。`excerpt_only` **不是**网站许可。

## 最值得下一步核实（最多 3 个，本片不联网）

| 优先级 | URL | 理由 |
|--------|-----|------|
| 1 | `https://www.mpa.gov.sg/media-centre/details/port-marine-notice-no.-54-of-2026---navigation--restrictions-under-the-rts-link` | 标题明示 **航行限制**（RTS Link）；两次 Search 均命中；**可能**属作业/通航风险，需读文确认区域、时段与是否影响商港。 |
| 2 | `https://www.mpa.gov.sg/media-centre/details/port-marine-notice-107-of-2026-scheduled-maintenance-of-ica-crew-system-8-and-15-sep-2026` | 标题明示 **ICA CREW 系统计划维护**（2026-09-08/15）；**可能**影响到港手续时效，需读文确认是否造成实质延误。 |
| 3 | `https://www.mpa.gov.sg/media-centre/details/port-marine-circular-no-10-of-2026-submission-of-accurate-information-for-vessel-port-calls-and-port-clearance` | 官方 **PMC 10** 合规 circular；两次 Search 均命中；试点 Fetch 对该 URL **404**（见 live 收口证据）— 若业务需要正文，需 **另授权** 读页方式，**不能**假设 DeepSeek Fetch 可用。 |

**读原页时最小确认问题（示例）**：生效/适用日期、地理范围（锚地/航道/全港）、是否强制、与八港业务是否相关、是否构成 Event 级「中断/恢复」还是一般行政通知。

## 当前证据能证明 / 不能证明

**能证明（在元数据层）**

- 两次 Search 各返回 10 条保存候选；回执 ID 与 ledger 一致。
- 按 **精确 URL** 去重后 **18** 个唯一目标；其中 **2** 个 URL 在两次 Search 中重复出现。
- 给定 URL 的主机名、搜索返回的标题字符串、提供方日期字段（未核验）。

**不能证明**

- 原页真实性、正文、完整日期、事件是否已发生/结束。
- 候选是否仍在线、是否与 MPA 当前站点结构一致（PMC 03 等 slug 与 PMC 10 不同，Fetch 试点均失败）。
- 第三方新闻与 MPA 原文是否一致；`wap.sol.com.cn` 与检索意图的相关性。
- 任何港口 **实际** 拥堵、停航或延误。

## 不联网仍可继续的事项

- 将 18 条 URL 与 `docs/intel-source-catalog.md` / R2 新加坡源配置 **人工对照**（是否已有注册 catalogId、许可与 persistence 边界）。
- 维护 **slug 变体清单**（如 PMC `no.-03` vs `no-10`）供日后 **单独授权** 的读页/Fetch 策略讨论。
- 对第三方报道与 MPA 官方条目做 **引用关系表**（仍不读页，仅记录「新闻指向哪条 circular」的标题级猜测，标为 unverified）。

## 文件

| 文件 | 内容 |
|------|------|
| `dedupe-summary.json` | 去重计数、跨次重复列表、疑似同题、分类聚合 |
| `candidates.json` | 18 条唯一 URL 记录（含分类与限制） |
| `candidates.csv` | 同上（便于表格查看） |

生成方法：本机 worktree `.tmp/build-candidate-review-artifacts.mjs`（**未提交**；只读 ledger，可复跑）。

**R2 计数**：本片 **不** 增加 R2-4/R2-5 资格或 qualification 计数。
