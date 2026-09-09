# Shipping HOT 六国官方日历数据补全方案

## 最新需求澄清 — 2026-09-09（优先于下方旧提案）

- 用户已批准先以有明确限制说明的年度参考月历接入五国资料。当前本地展示快照为 100 条，位于 `server/data/annual-calendar/`；候选目录保留作录入证据。`/calendar` 仅显示只读月历；用户已要求移除运营缓存切换入口，既有后台和历史数据不删除。TH 现为 23 条参考事项但全国 SOC 主依据正文仍待核验，VN 4 月 27 日以条件性补休录入；不宣称完整覆盖。实际验证以 `docs/status.md` 当前年度参考日历小节为准。
- 年度参考月历基线已提交为 `main@ce904192784ba6fe010c8f0afdcf531836c41b04` 并在推送时实时核对远端一致。此后泰国 23 条候选资料已在本地提升到正式展示快照并通过独立复审，当前尚未提交；这不改变 partial/pending 结论，也不代表完成人工双人复核。

- 当前先完成印度尼西亚（ID）2026 年候选样本，采用固定年度 JSON 文件；样本只用于确认内容和格式，不接入现役数据加载路径。
- FullCalendar 仅作前端展示参考，不安装依赖、不复制源码；复杂自动同步、来源表和 schema migration 继续暂停。
- 用户目标是货代年度台历：日期格显示各国假日/补班，通过国家筛选查看，不是自动同步官方公告的系统。
- 用户进一步确认：中国不纳入本次年度台历数据整理；首批聚焦现有东南亚五国 TH（泰国）、ID（印度尼西亚）、MY（马来西亚）、PH（菲律宾）、VN（越南）。不自动扩展至其他东南亚国家，也不删除现有系统中的中国数据或能力。
- 当前优先事项是整理、核验和统一上述五国已发布的年度假日数据。普通年月日由日历组件生成，无需采集。
- FullCalendar Standard 仅记录为前端候选参考：https://fullcalendar.io/docs/react 、https://github.com/fullcalendar/fullcalendar 。未决定安装或复制源码，未授权新增依赖。
- 候选数据组织：按国家/年份保存本地年度文件，统一日期、名称、类型、适用范围和官方证据字段；先完成一个东南亚国家的年度样本再推广。本条是整理方向，不是已定稿的数据合同。下方六国/CN 的旧范围不覆盖本次最新范围。
- 不要求日常自动抓取或定时更新；保留官方临时修订时人工更正的可能。无正式依据的日期不推算为官方事实。
- 下方 Level 2、来源表、legacy baseline、writer fingerprint、选择性 Runtime 和 migration 等内容保留为历史未批准提案，暂停推进，不是当前年度台历的实施前提。
- 本次仅记录需求与前端参考，不代表已录入业务数据、完成官方核验或批准数据库/Provider 改造。

---

- 状态：`proposal / awaiting approval`
- 调研基准日：2026-09-09（Asia/Shanghai）
- 目标年份：2026、2027
- 国家：CN、TH、ID、MY、PH、VN
- 变更级别建议：**Level 2 proposal**。即使首批只使用本地人工数据集，也必须调整 Calendar 缓存 requirement、合成 Provider 选择性执行和 coverage DTO；任何官方网页自动解析仍须另行批准
- 本文不是批准记录、实现记录或完整覆盖证明

## 1. 基线与边界

当前提交基线为 `main` / `ce904192784ba6fe010c8f0afdcf531836c41b04`；该年度参考月历提交已推送，并在推送后用 `git ls-remote origin refs/heads/main` 实时核对一致。工作区保留 `pages.tsx` 的换行状态与未跟踪 `.tmp/`；泰国 23 条候选与展示提升是其后的未提交改动。

以下能力已经存在，本方案不重复开发：六国、当前年与下一年分别同步；Calendar 本轮记录计数；全缓存命中 `skipped/calendar_cache_fresh`；`cacheRequiredSourceIds` 区分占位来源与真正配置来源；缓存跳过不覆写 Runtime 历史证据；Calendarific、official、manual 的合成和 last-known 保留。

本轮没有读取 Secret、保留数据库或 `.tmp/` 内容，没有调用 Calendarific/其他付费 API，没有启动 Provider 或 Web，也不涉及港口目录、JMA、资讯源、商业船期、Translation 或性能配置。

## 2. 推荐业务口径

### 2.1 必须覆盖（建议批准范围）

对六国 2026/2027，按每个 `country/year` 独立判断：

1. 全国适用的法定/公共假日；
2. 全国适用的特别非工作日、替代休假；
3. 官方明确规定的全国补班、调休日（补班必须建模为 `government_special`/非假日运营事件，不能伪装成公共假日）；
4. 公告明确保留到后续确认的全国日期（例如菲律宾 Eid、越南年度安排），在最终公告前只能是 pending，不能推算成官方事实；
5. 每条事实的官方原始链接、公告编号、发布日期/修订日期与获取日期。

“完整”只表示在上述批准口径内，已取得该国该年正式发布、仍有效的全国公告，且公告中所有延后确认项已有最终文件。它不表示港口停运、银行停业、私营企业停工或全国所有地方节庆完整。

### 2.2 非必须覆盖（建议排除首批）

- 所有州、省、市、自治区或宗教社区的地方节日；
- 仅适用于银行、政府机关、学校或特定行业的休息日；
- 港口、码头、海关、承运人自己的作业安排。

地方/州级事件只在以后明确批准“重点港口所在行政区”且有可靠行政区编码时纳入，状态按 subdivision 单独计算，不提升全国 coverage。泰国 BOT 银行业假日仅作来源调研参考，不纳入 Batch 1/2 数据接入，也不能证明全国公共假日完整；马来西亚官方表包含州级列，首批只提取全国/联邦适用项，保留州级原文证据而不全部导入。

## 3. 三轴状态合同与贯通映射（Level 2 proposal）

独立审查确认，现有 `CalendarCoverage.status=complete|partial|unknown` 同时承担业务完整性、装载成败和缓存新鲜度，无法正确表达“正常取得一份明确标记尚未发布的清单”。现有摘要又只把 `Boolean(error)` 视为失败：只写 `errorCode` 而没有 `error`，原因不会进入 `errors`；若加上 `error`，正常的 `not_published` 又会被误报成 `partial_failure`。因此不能只补 UI 文案，必须把三类状态分别表达。

### 3.1 允许字段与组合

建议给 `CalendarCoverage`/API DTO 增加以下显式字段（命名可在实施评审时微调，语义不可合并）：

| 轴 | 建议字段/值 | 含义 |
| --- | --- | --- |
| 业务完整性 | `contentStatus: not_configured | evidence_pending | not_published | confirmed_partial | confirmed_complete | confirmed_empty` | 官方内容在批准 scope 内是否完整；`confirmed_empty` 是有明确官方证据的完整零事件 |
| 装载状态 | `loadStatus: not_loaded | applied | validation_failed` | 本地数据集是否成功校验并应用；不代表内容完整 |
| 刷新状态 | `refreshStatus: fresh | stale | due | missing` | 根据已应用版本、目标版本和 TTL 判断是否需要该来源刷新 |
| 版本 | `desiredRevision`, `desiredHash`, `appliedRevision`, `appliedHash` | manifest 当前目标版本与 Repository 已成功应用版本 |
| 检查时间 | `lastAttemptAt`, `lastSuccessfulAt` | 本次尝试与最后成功应用分开；失败不能刷新成功时间或 TTL |
| 正常业务原因 | `statusReasonCode`, `statusMessage?` | `official_evidence_pending`、`official_not_published` 等；不进入 operational errors |
| 操作失败 | 现有 `error`, `errorCode` | 仅用于读取、校验、持久化或 Provider 执行失败 |

允许组合示例：

- 未纳入/未配置：`not_configured + not_loaded + missing`，没有 cache requirement，不触发 official 同步；
- 已配置且清单正常声明“截至核查日证据不足”：使用 `evidence_pending + applied + fresh`；只有主管机构/正式发布目录明确证明该年度尚未发布时才可用 `not_published + applied + fresh`。两者业务未完整但都不是同步失败；
- 已配置且只取得部分正式公告：`confirmed_partial + applied + fresh`；到 TTL/版本变化前不重复刷新；
- 已配置但文件缺失、陈旧或校验失败：保留上次 `contentStatus/appliedRevision`，`validation_failed + due`，产生 operational `error/errorCode`；
- 已确认完整且零事件：`confirmed_empty + applied + fresh`，0 events 是经证据确认的事实；
- 已确认完整且有事件：`confirmed_complete + applied + fresh`。

禁止组合：`unknown` 被当作 fresh、`validation_failed` 没有 operational error、仅凭事件数为零推导 `confirmed_empty`、仅凭本轮返回零条取消来源 requirement。

### 3.2 端到端映射

| 层 | 必须输出/保存 | 正常 pending | 真失败 |
| --- | --- | --- | --- |
| manifest | country/year/scope、`contentStatus`、目标 revision/hash、证据与复核状态、`configured` | 明确记录 `evidence_pending/not_published`，不生成推算事件 | 文件/字段/哈希无效，校验不通过 |
| Official Provider | 事件 + 带三轴状态和版本的 coverage；只处理 Runtime 指定单元 | 返回成功结果，`loadStatus=applied`，无 `error` | 返回/抛出受控失败；不得声称新版本已应用 |
| Runtime | 对 requirement 独立计算 due；按来源和单元执行；运行结果与业务完整性分开 | 可为 operational `success`，但 coverage 仍 partial/pending | 该 source/cell 记失败；保留其他成功结果和 last-known |
| Repository | 保存事件、coverage 三轴状态及最后成功应用版本；更新必须原子化到 source/cell | 保存正常 pending 与检查时间 | 保留旧事件和旧 applied revision，同时保存失败证据/目标 revision |
| API 摘要 | `contentStatus/loadStatus/refreshStatus/statusReasonCode` 与 errors 分开返回 | 显示“证据待核实/未取得正式年度依据”，错误数为 0 | `syncStatus=partial_failure`，错误数组包含失败来源 |
| UI | 分别展示业务覆盖、数据集应用、刷新状态；保留来源与时间 | 显示 partial/pending，不显示 Provider 失败 | 显示失败及 last-known，不用业务 pending 文案掩盖错误 |

现有 `CalendarCoverage.status` 可在兼容期保留为派生字段：`confirmed_complete/confirmed_empty → complete`，`confirmed_partial → partial`，其余业务状态 → `unknown`。但是 cache 和 Runtime 成败不得再从这个兼容字段推导。现有 `summarizeCalendarCoverage`、Calendar API DTO 和 UI 均需适配；这属于核心接口变化，按 Level 2 审批。

## 4. 六国 × 两年份官方证据矩阵

以下只采用政府、央行、司法机关等一手站点。搜索未命中只形成“截至核查日证据不足”，不等同于官方数据不存在。公开访问免费不代表已授权自动抓取或任意再分发；除菲律宾 PCO 明示内容原则上属于 public domain 外，本轮未在原始页面确认适用于自动化复制的数据许可。

| 国家/年 | 发布机构、发布日期与原始证据 | 地域/类型、格式 | 当前结论 | 自动读取、复用与维护缺口 |
| --- | --- | --- | --- | --- |
| CN 2026 | 国务院办公厅，2025-11-04，国办发明电〔2025〕7号；[国务院公报 PDF](https://www.gov.cn/gongbao/2025/issue_12406/material/gwygb202532.pdf)。法定基础：[全国年节及纪念日放假办法](https://www.gov.cn/gongbao/2024/issue_11726/material/gwygb202433.pdf) | 全国公共假日、调休与补班；PDF | **可靠、可形成全国完整候选**。包含每个连休区间和补班日 | 免费公开；未确认机器接口或开放许可。PDF 版式相对稳定但自动解析风险高，建议人工双人录入/复核 |
| CN 2027 | 截至 2026-09-09 的本轮检索未取得国务院办公厅年度安排原件；这不是“官方尚未发布”的证明 | 法定办法可说明假日制度，但不能给出年度调休/补班 | **evidence_pending（证据不足）** | 不按农历或第三方推算；Batch 0 继续核验原件和发布状态 |
| TH 2026 | 泰国政府站提供具体公告，例如 [宋干节 2026](https://www.thaigov.go.th/th/news/162975)（2026-04-10）、[曼谷特别假日](https://www.thaigov.go.th/th/news/164228)（2026-05-19）；泰国央行 [金融机构假日页](https://www.bot.or.th/en/financial-institutions-holiday.html) 及 [2026 公告 PDF](https://www.bot.or.th/content/dam/bot/fipcs/documents/FPG/2568/EngPDF/25680162.pdf) | 政府单项公告；BOT 仅金融机构/专门金融机构；HTML/PDF | **全国公共假日证据仍不足**；BOT 年表可靠但只能标 sector/banking，曼谷项只能标 subdivision | 免费公开；页面/选择器结构和复用条款未确认。首批不可用 BOT 列表替代全国列表 |
| TH 2027 | 泰国央行页面显示 B.E. 2570 (2027) 金融机构假日发布记录：[金融机构假日页](https://www.bot.or.th/en/financial-institutions-holiday.html)、[BOT 首页](https://www.bot.or.th/en/home.html) | 仅金融机构行业范围；HTML/链接公告 | **仅作检索参考，不纳入 Batch 1/2 数据接入；全国口径 evidence_pending** | Batch 0 需取得全国政府原件。不得将行业日历映射为全国 complete 或港口停运 |
| ID 2026 | 印尼人类发展与文化统筹部，2025-09-19，[17 个全国假日与 8 个集体休假日公告](https://www.kemenkopmk.go.id/node/5863)，页面链接三部长联合决定 PDF；[PPID 公共信息目录](https://ppid.kemenkopmk.go.id/informasi-serta-merta-admin)（2025-09-25） | 全国假日 + `cuti bersama`；HTML/PDF | **可靠、可形成全国完整候选**，但宗教日期如有后续主管机关修订须跟踪 | 免费公开；无明确 API/复用许可。下载文件版本与后续修订需人工核对 |
| ID 2027 | 截至 2026-09-09 的本轮检索未取得 2027 三部长联合决定原件；不据此断言尚未发布 | — | **evidence_pending（证据不足）** | Batch 0 继续核验；不从宗教历或 2026 模式推算 |
| MY 2026 | 马来西亚首相署 BKPP [公共假日入口](https://www.kabinet.gov.my/hari-kelepasan-am/)；[2026 表 PDF](https://www.kabinet.gov.my/storage/2025/08/HKA-2026.pdf)；[2025-08-28 宪报 PDF](https://www.kabinet.gov.my/storage/2025/09/GN-33499-GN-33501-TS-28-8-2025-JABATAN-PERDANA-MENTERIBHG-KABINETPERLEMBAGAAN-PERHUBUNGAN-ANTARA-KERAJAAN-AGJ971.pdf) | 联邦及各州，含替代规则；PDF/宪报 | **可靠**。全国/联邦 scope 可形成完整候选；州级只做可选范围 | 免费公开；站点保留版权，自动化复用条件不明确。需跟踪 [法令与宪报页](https://www.kabinet.gov.my/akta-dan-warta/) 的追加/修订 |
| MY 2027 | BKPP 官方页面出现“[Hari Kelepasan Am Tahun 2027](https://www.kabinet.gov.my/?id=67&option=com_content&view=article)”条目，但本轮未稳定取得并核验其直接原件 | 页面条目指向联邦/州级年度表；原件格式待核验 | **evidence_pending**；页面条目和搜索摘要不能替代正式原件，当前不能标 complete | Batch 0 必须固化原件、校验发布机构、哈希、适用范围和修订状态 |
| PH 2026 | 菲律宾总统通讯办公室，2025-09-04，[Proclamation No. 1006 年度公告](https://pco.gov.ph/news_releases/pbbm-issues-proclamation-declaring-regular-holidays-special-non-working-days-for-2026/)；司法机关 [Supreme Court E-Library 法律文本](https://elibrary.judiciary.gov.ph/thebookshelf/showdocs/7/99678)。后续 [Eid'l Fitr](https://pco.gov.ph/news_releases/palace-declares-march-20-regular-holiday-nationwide-for-eidl-fitr/)（2026-03-13）与 [Eid'l Adha](https://pco.gov.ph/news_releases/palace-declares-may-27-as-a-regular-holiday-for-eidl-adha-observance/)（2026-05-22） | 全国 regular、special non-working/working、后续 Eid；HTML/PDF | **可靠、可形成全国完整候选**，前提是合并两项后续 Eid 公告 | PCO 页面明示内容原则上 public domain（另有声明除外），免费公开；地方 proclamation 持续发布，不纳入全国 complete |
| PH 2027 | 截至 2026-09-09 的本轮检索未取得 2027 全国年度 proclamation 原件；不据此断言尚未发布 | — | **evidence_pending（证据不足）** | Batch 0 继续核验；不推算 Eid，地方公告也不能替代全国年度公告 |
| VN 2026 | 越南政府办公厅，2025-10-13，[Công văn 9859/VPCP-KGVX 文档页及签署 PDF](https://chinhphu.vn/?docid=215596&pageid=27160)；法定基础见官方公报 [劳动法 Article 112 PDF](https://congbaocdn.chinhphu.vn/180507251028987904/2026/3/5/468971-1772684381_v1_1772690833_signed.pdf) | 全国法定假日；年度文件重点确定春节、国庆安排；HTML/PDF | **可靠但需组合核验**：法定固定日 + 年度春节/国庆安排；任何 2026 年中法律新增项必须以最终法律文本再核验 | 免费公开；自动解析/复用条件未明确。建议人工维护并保留两类法律依据 |
| VN 2027 | 越南政府政策站页面载有 [春节 2027 两套建议方案](https://xaydungchinhsach.chinhphu.vn/de-xuat-2-phuong-an-nghi-tet-nguyen-dan-2027-tet-dinh-mui-11926080513033257.htm) | 部门建议方案；HTML | **evidence_pending**；建议方案不是最终公告，方案日期不得进入正式事件 | Batch 0 等待并核验最终文件；该链接只作待办线索，不生成业务数据 |

### 4.1 证据结论

- 2026：CN、ID、MY、PH 有足以建立“全国口径完整候选”的一手年度依据；VN 有可靠组合依据但实施前需逐项核对法律新增/年度安排；TH 只有零散全国公告与完整的银行业日历，尚不足以证明全国口径完整。
- 2027：MY 官方页面存在年度表条目但原件未完成核验；TH 只有银行业参考；VN 页面为建议方案；CN、ID、PH 截至核查日均未取得可验证的年度正式原件。以上统一标 `evidence_pending`，不由检索结果推断“尚未发布”。
- 因此当前不能宣称六国双年份官方完整覆盖，也不能把 Calendarific 返回的数据提升为官方确认。

## 5. 推荐架构：分国人工维护的官方证据数据集

### 5.1 为什么推荐人工维护而非自动解析

六国原件混合 HTML、PDF、扫描/公报、单项追加公告，且发布日期、修订和适用地域差异明显。年度数据量小，人工录入并双人复核的维护成本低于为六套不稳定页面建立解析器，也更容易记录“证据不足/未发布/提案/撤回”。首版不需要新网络 Provider、SDK、依赖、Secret 或外部运行时调用。coverage 新字段本身预计可保存在现有 JSON 中，但整体方案明确需要第 5.3、5.9、5.10 节的 additive schema migration；两者不能混写为“无需 migration”。

建议数据位置（待批准后实施）：

```text
server/data/calendar/official/
  manifest.json
  CN/2026.json
  TH/2026.json
  ...
```

`manifest.json` 每个 country/year 至少记录：

- `countryCode`, `year`, `scope`（首批为 `national`）；
- `configured`、第 3 节 `contentStatus` 与 `completenessBasis`；没有原件支持时默认 `evidence_pending`，不能凭搜索未命中写成 `not_published`；
- 发布机构、公告编号、`publishedAt`, `effectiveAt`, `retrievedAt`；
- 原始 URL、文档格式、内容哈希、数据集版本；
- `supersedes`/`supersededBy`、待后续确认项；
- 自动读取许可/复用条款结论与人工复核人/复核日期。

事件文件记录正式假日、替代休假、补班/调休日及适用范围。补班日不能使用 `isPublicHoliday=true`。`sourceUpdatedAt` 取官方文件发布日期/最后修订日期；`lastAttemptAt` 取本次尝试时间，只有成功原子应用才能更新 `lastSuccessfulAt`，兼容字段 `lastCheckedAt` 由成功时间派生。不能用本地文件更新时间伪造官方更新时间。

### 5.2 缓存与 Provider 合同方案比较

现状问题不是 source ID 名称本身。当前 `cacheRequiredSourceIds` 是 Provider 级全局列表，`countriesDueForSync` 对一个国家/年份要求同一组来源；合成 Provider 一旦被调用，又会并行调用全部子来源。因此仅装载 CN 2026 时，其他 11 个 pending 单元可能令 official 永久 due，并顺带重复调用仍在七日 TTL 内的 Calendarific。统一 `official-holiday-source` 不能避免此问题。

| 方案 | 合同 | 能否避免连带请求 | 代价 | 判断 |
| --- | --- | --- | --- | --- |
| A. 仅按 country/year 返回必需来源 | Provider 提供 `requirementsFor(country, year)`；Runtime 按单元判 due，但仍调用整个合成 Provider | **不能保证**。official due 时合成调用仍可能包含 Calendarific | 中 | 不单独采用 |
| B. 仅按来源隔离刷新 | Runtime 可指定只调用 official 或 Calendarific，但 requirement 仍是全局 | 可避免部分连带请求，但未配置/pending 单元仍可能错误永久 due | 中 | 不单独采用 |
| C. 单元级 requirement + 按来源选择性执行 | requirement 键为 `country/year/sourceId`，Runtime 只执行 due 的 source/cell | **可以**，同时解决错误必需与合成连带调用 | Level 2 核心合同调整，但无需新外部 Provider | **推荐的最小完整方案** |

推荐合同（概念接口，不是已批准 API）：

```ts
interface CalendarCacheRequirement {
  countryCode: CalendarCountryCode
  year: number
  sourceId: string
  configured: boolean
  desiredRevision?: string
  desiredHash?: string
}

interface CalendarProvider {
  getCacheRequirements: (query: CalendarQuery) => CalendarCacheRequirement[]
  getEvents: (query: CalendarQuery, selection?: { sourceIds: string[] }) => Promise<CalendarProviderResult>
}
```

- 未纳入、未配置的 official 单元返回 `configured=false` 或不返回 requirement；它可以作为 API catalog 的 `not_configured/evidence_pending` 展示项，但不参与缓存命中判断；
- 已配置的 `not_published/confirmed_partial` 数据集仍返回 requirement。它们业务上不完整，但若目标版本已成功应用且在 TTL 内，装载/刷新可以是 fresh；
- 已配置但缺失、陈旧、校验失败的单元保持 required/due，不能把 unknown 当 fresh；
- `confirmed_empty` 仍 required，只有明确证据、版本已应用且 fresh 才能缓存命中；
- requirement 由 manifest 的显式 `configured` 和版本合同决定，绝不依据本轮事件数或缓存中是否已有记录猜测；
- Runtime 把 due 单元按 `sourceId` 分组，Composite Provider 只分派被选中的子来源。official 本地版本更新只执行 official；Calendarific fresh 时绝不被顺带调用；
- 当前年与下一年、每个国家、每个来源均独立判断，部分 due 不影响其他 fresh 单元。

首批仍复用现有 Official Provider 的职责和 `official-holiday-source` provenance，不新增网络 Provider；但 `createOfficialHolidayProvider({ events })` 必须扩展为显式 dataset/coverage 输入，因为仅靠 events 无法表达 complete、confirmed empty 或正常 pending。以上接口和 Runtime 调度是 Level 2，不得继续描述为 Level 1，也不得推迟到地方/自动解析阶段。

### 5.3 选择性同步的写入、来源事实与合并合同

#### 现状核查

当前 `reconcileCalendarEvents` 先调用 `mergeCalendarSources`，Repository 的 `calendar_events` 表保存的是合并后的展示结果。相同事实由 official 取代 Calendarific 时，合并记录的 `evidence` 只保留 provenance/时间，并不保存被覆盖来源的完整名称、日期、类型、scope 等原始事实。因此现有持久化不足以在“只更新一个来源”后可靠恢复其他来源并重新合并，不能假定未执行来源仍有完整原始快照。

#### 推荐数据保留方案（需批准 additive migration）

新增来源事实存储 `calendar_source_events`，按 `source_type/dataMode/country/year/sourceId/sourceEventId` 保存每个 Provider 的原始规范化事件并维持 Real/Mock 隔离；现有 `calendar_events` 继续作为所有有效来源事实计算出的合并投影，避免改变 API/业务引擎读取已合并事件的基本方向。coverage、版本和错误仍由 Calendar source/cell 状态拥有。

选择性执行结果必须显式返回：

- `executedCells: Array<{ countryCode, year, sourceId, snapshotKind }>`；
- `snapshotKind: complete | partial`，表示本次结果是否是该来源/单元的完整权威快照；
- 本轮事件只属于列出的 source/cell；Provider 不得返回未获选择的来源结果；
- 删除授权使用显式 tombstone，或 `snapshotKind=complete` 且该数据集合同明确允许“缺席即撤回”。

Repository 提供一个单一写入口（概念名 `applyCalendarSourceSnapshot`），对每个执行单元完成：

1. 校验 result、selection、sourceId、country/year、snapshotKind 和 desired revision/hash 一致；
2. 只更新键为 `country/year/sourceId` 的 coverage、`lastAttemptAt/lastSuccessfulAt`、版本和当前失败证据；未执行来源的所有字段逐字保持不变。失败可推进该单元 `lastAttemptAt`，但不能推进 `lastSuccessfulAt` 或 applied 版本；
3. `complete` 快照可在该来源/单元内用新集合替换旧集合；`partial` 只能 upsert 成功事实并保留未返回的 last-known，禁止把缺席当删除；
4. 从 `calendar_source_events` 读取受影响 country/year 的 **全部有效缓存来源事实**，重新运行既有优先级：manual 显式覆盖 > official > Calendarific/其他 third-party；保留 conflict、`conflictingSourceIds` 和每个来源 evidence；
5. 只重建受影响 country/year 的 `calendar_events` 合并投影，未执行来源不能因本轮缺席被降级或删除；
6. 仅在来源事实和合并投影成功后保存该单元 coverage 及 `appliedRevision/appliedHash`。

撤回/删除被限制在明确的 `country/year/sourceId`：

- tombstone 必须带官方修订/撤回证据及目标 source event identity；
- 完整快照替换只能删除同一执行来源、同一单元中缺席的旧事实；
- partial、validation failure、Provider failure、未执行来源或空但未声明 complete 的返回均无删除权；
- 重新生成合并投影时，如果其他来源仍有同一事实，其来源事实继续存在并按优先级成为展示结果。

替代方案是让现有 `calendar_events` 同时保存各来源原始行，并在每个读取路径临时合并。它不需要新表，但会改变现有表的“业务可读合并事件”语义，容易让未改造的告警/API读取到重复事实，也难区分历史合并行与原始行，故不推荐。若用户不批准 additive migration，本提案不能安全启用选择性来源同步；应保留现有整体合成同步，不用不完整 evidence 冒充可恢复的原始快照。

### 5.4 去重、冲突与修订

现有合并以 `country + date + normalized name + scope + type` 为事实键，official 优先于 Calendarific，manual 可按同事实或唯一逻辑名称覆盖，并保留 evidence/conflict 信息。首批沿用此合同，但增加以下数据治理约束：

1. 同日不同名称或不同类型不自动视为同一事实，禁止模糊名称匹配；
2. Calendarific 与官方同日同事实：展示 official 主记录，保留第三方 evidence；
3. 同日事实冲突：官方日期/类型优先，标记 `conflict=true` 和来源，不静默覆盖；
4. manual 只用于有审计理由的纠错/业务补充，不能把推算日期提升为 official；
5. 官方修订生成新数据集版本，旧版本标 `superseded`。只有第 5.3 节事务成功应用带授权证据的 tombstone/完整快照后，才可删除该 official source/cell 的旧事实；若获取、校验或事务失败，则保留 last-known，不执行撤回；
6. 替代休假与被替代日期分别建模，补班日单列为非假日 `government_special`，避免区间展开丢失运营含义。

现有名称键对跨语言同一假日可能无法自动合并。首批以人工数据集中的稳定规范名和受控别名处理；不得用相似度推断。若需要正式 alias ID/关系表，再提交模型变更提案。

### 5.5 数据集版本失效、失败保留与年度滚动

仅修改 manifest/事件文件不会使现有七日缓存失效。必须持久化“目标版本”和“最后成功应用版本”的差异，并把版本差异纳入 source/cell 的 due 判断。

推荐最小合同：

1. **当前版本**：随应用发布的 manifest 为 desired truth；每个 `country/year/sourceId` 有单调 `desiredRevision` 和内容 `desiredHash`。进程启动时只读装载并校验 manifest，不调用外部来源；
2. **已应用版本**：Repository 保存 `appliedRevision/appliedHash`，仅在该 source/cell 的来源事实、合并投影、coverage 和版本处于同一事务且全部成功后更新；Provider 校验成功不等于 Repository 已应用成功；
3. **比较时机**：Runtime 每次计划 Calendar job 及进程重启后的首次计划，都比较 desired 与 applied。不同即该 source/cell `due`，不受七日 TTL 保护；相同再按 `lastSuccessfulAt` 计算 TTL；
4. **精准失效**：只有 revision/hash 变化的 `country/year/sourceId` 失效。CN 2026 新版本不得令 CN 2027、其他国家或 Calendarific 失效；
5. **校验失败**：不更新 applied revision/hash，不删除旧事件，不执行撤回；保存 desired revision/hash 和 operational failure，继续提供带 stale/failed 标记的 last-known；
6. **回退**：回退 manifest 必须使用一个新的、更高 revision，并以 `supersedes` 指向错误版本，不能悄悄把 revision 数字倒退。成功应用后按新版本明确的事件集 reconcile；
7. **撤回**：撤回也是新 revision，manifest 明确列出撤回事实/替代公告。只有新版本完整校验并原子应用后才删除被撤回事件；
8. **来源隔离**：本地 official 版本差异只选择 official source/cell；若 Calendarific 的 applied coverage 仍 fresh，其调用数必须为 0；
9. **TTL 与计数**：TTL 保持 7 天。全缓存命中仍为 `skipped/calendar_cache_fresh`、本轮计数为 0、Runtime 历史证据不变；实际同步仍只统计本轮 normalized records，`provider_usage.request_count` 仍表示 capability sync invocation count。

Provider 的“成功”只表示它返回了通过格式、身份、范围和哈希校验的候选 snapshot；它不得写 applied 字段，也不得把候选描述为已生效。只有 Repository transaction 提交成功后，该 source/cell 才进入 `snapshotState=initialized/loadStatus=applied` 并推进 applied revision/hash 与成功时间。

原子应用边界必须由 Repository 而不是 Runtime 的多次公开方法拼接：在一个 db0/SQLite transaction 中完成该批受影响 source/cell 的 `calendar_source_events` upsert/delete、`calendar_events` 合并投影替换、coverage 三轴状态和 applied revision/hash 保存。任一步失败全部回滚。事务失败后可另行写一条受控 Runtime/失败状态，但该失败记录不得推进 applied 版本，也不得改变已回滚的事件和 coverage 成功检查时间。对同一 `source/cell/revision/hash` 的重复应用必须幂等；并发运行必须通过现有 Runtime 串行边界或 Repository 事务保证不会发生旧版本覆盖新版本。

持久化评估：coverage 三轴状态和版本仍可优先保存在现有 `settings.calendarSync` JSON；但第 5.3 节已经确认需要可靠保存各来源完整事实，推荐新增 `calendar_source_events` 表和 additive schema migration。该 migration、事务 API 和回退方案必须单独获批，本文不再宣称整体方案“无需 migration”。若后续能以等价证据证明无 migration 方案满足来源隔离、原子性和所有读取兼容要求，可另行复审，但不得在实施中自行替换。

年度滚动先建立 `evidence_pending` catalog 单元但不自动把它设为 configured/required，也不生成事件。只有原件核验并决定接入后才设置 `configured=true`；正式公告尚不完整可以是正常 `confirmed_partial + applied + fresh`，不会永久触发循环。

### 5.6 Registry 身份、数据集校验失败与恢复

`configured` 身份不能由“文件是否成功读取”反推。建议 Registry 使用一份受代码审查的静态声明（例如 `officialCalendarDatasetRegistry`）列出**未来获批准接入的** `country/year/sourceId`、manifest 路径和启用状态；数据文件/manifest 是被校验输入。这样可以区分：

- 未声明/未启用：`not_configured`，不产生 requirement；
- 已声明启用且有效：产生 requirement，按内容/版本决定 fresh/due；
- 已声明启用但文件缺失、格式错误、哈希不符：身份和 requirement 保持，`validation_failed + due`，记录经过清理的 operational error，绝不能过滤成 placeholder；
- 已声明且 `confirmed_empty`：仍 required，成功应用后可 fresh。

校验隔离：

1. **单个数据文件损坏**：只使对应 `country/year/sourceId` 失败；其他 official 单元、Calendarific、manual、Mock 不受影响；
2. **manifest 整体无法解析/哈希目录损坏**：Registry 仍根据静态声明保留全部已启用 official 单元身份并标 validation failure；official 本轮不输出新事件/删除，其他来源可按各自 due 状态继续，不能静默退化成“official 未配置”；
3. 错误信息只暴露逻辑 dataset key、受控错误码和可公开版本标识，不回传文件正文、绝对路径或敏感环境内容；
4. 文件修复且 desired revision/hash 未变时仍允许同版本重试；成功事务提交后清除当前失败、更新 `lastSuccessfulAt`（兼容 `lastCheckedAt` 由其派生），但保留历史 Runtime 失败证据的既有语义；
5. 重启后 Registry 重建相同 identity，Repository 的旧 applied 版本和 last-known 继续可用，直到修复版本原子应用成功。

Registry 不得只注册“通过校验的数据集”。静态声明决定 configured identity/requirement；校验层只决定是否能向 Provider 交付候选。校验失败的单元仍注册为失败 requirement，Provider 对该单元返回受控失败且不返回事件候选。

### 5.7 UI 如实展示

UI/API 必须消费第 3 节三轴 DTO，不能只在现有 `complete/partial/unknown` 上增加模糊文案：

- `complete`：明确写“官方全国范围已核对”，并注明不代表港口停运；
- `partial`：列出缺少的类型或待最终公告日期；
- `evidence_pending/not_published`：显示正常业务 pending，并与同步失败分栏；没有核验原件时只写“截至核查日证据不足”；
- `validation_failed/stale`：显示失败、目标版本和 last-known 已应用版本；
- subdivision/sector（例如 MY 州级、TH 银行业）不能抬高 national coverage；
- Calendarific 有数据而 official pending 时仍显示 partial/pending，不显示“官方完整”。

现有摘要只收集带 `error` 的行，不能靠单写 `errorCode` 展示正常 pending。提案要求修改共享 DTO、摘要函数、API 和 UI；正常 `statusReasonCode` 不进入 errors，真实 operational error 必须进入 errors。

### 5.8 旧数据与旧式 Provider 兼容

新字段缺失不能统一映射为 `missing`，否则现有 Calendarific/manual/Mock 会在每轮永久重同步。兼容适配规则如下：

- 旧 coverage 行若 `status=complete|partial`、无 `error` 且 `lastCheckedAt` 有效，则在内存中把该时间映射为 `lastAttemptAt=lastSuccessfulAt`、视为 `loadStatus=applied`，并用原 TTL 计算 fresh/stale；赋予只用于兼容的合成版本 `legacy:<sourceId>:v0` 作为 desired/applied 相等值，不因缺少新字段立即重刷；
- 旧 coverage 为 `unknown`、带 error、缺少/无效检查时间时保持 due；不得当 fresh；
- 旧 placeholder official/manual 的 `cacheRequiredSourceIds=[]` 继续不产生 requirement；Mock complete、Calendarific/manual partial 的既有有效缓存继续按 TTL 工作；
- 只实现旧 `cacheRequiredSourceIds/getEvents` 的自定义 Provider 通过 legacy adapter 转成 queried country/year 的 requirements，并作为**不可拆分执行组**调用；适配器不能伪造选择性。生产 Calendarific/official/manual Composite 要满足新 selection 合同后，才可宣称来源隔离；
- 首次成功应用新合同后写入真实 applied revision/hash。现有合并 `calendar_events` 只能作为 legacy last-known 展示事实，不能反向重建被覆盖来源的完整原始快照；各来源在首次新合同同步成功前，删除权关闭；
- 代码回退不得让旧版本写入已经迁移的数据库；详细限制见第 5.10 节。旧 `calendar_events` 合并投影在只读回退中继续可读，新表/JSON 字段不得删除。

上述兼容规则需用旧 Calendarific、configured manual、placeholder manual/official、Mock 和一个自定义旧式 Provider fixture 分别验证。

### 5.9 首次升级与来源快照初始化

#### 风险与初始化状态

additive migration 完成时，新的来源表没有任何可信原始快照，而旧 `calendar_events` 只有合并投影。即使旧 Calendarific/manual coverage 仍在七日 TTL 内，也只能证明旧合成同步曾成功检查，不能证明 `calendar_source_events` 已初始化。每个 `country/year/sourceId` 因此必须另有：

- `snapshotState: uninitialized | initialized | invalidated`；
- `initializedRevision/initializedHash?`；
- `initializationReason`（`legacy_projection_only`、`provider_snapshot_applied`、`rollback_diverged` 等）。

旧成功 coverage 可继续支持 legacy 投影的 TTL 展示，但不能把 `snapshotState` 推导为 initialized，也不能授予来源级删除或全量重建权。

#### 推荐方案：封存 legacy baseline + 混合投影

同一个**待批准的** migration 还应新增 `calendar_legacy_projection`（名称可在 ADR 中确认），并在 migration transaction 中把升级前全部 `calendar_events` 原样复制为不可拆分的 legacy baseline，同时记录基线哈希/生成号。它是“旧合并结果”，不是 Provider 来源表：

1. 禁止把 baseline 中的 `evidence` 或 `sourceId` 拆解、复制为多个完整来源快照；
2. `calendar_source_events` 初始为空；旧 coverage 涉及的 Calendarific/manual/official/Mock 分别为 `uninitialized`，placeholder 未配置来源仍为 not configured；
3. 在某 country/year 仍有未初始化且可能贡献旧投影的来源时，业务 `calendar_events` 使用 **hybrid projection**：legacy baseline 作为不透明 last-known 层，加上已经原子应用的来源快照，再按 baseline 最终记录所携带的 source kind 与现有 `manual > official > third-party` 优先级处理碰撞；
4. 对已初始化来源的 `complete` snapshot，只可遮蔽/替换 baseline 中最终 `sourceId` 明确等于该来源的记录；`partial` snapshot 仍保留这些 baseline 记录并标 last-known。显式 tombstone 也只能作用于可明确归属的同源事实；不能用 baseline evidence 恢复被覆盖来源，也不能删除无法归属的 baseline 事实；
5. 仅应用 official 时，旧 baseline 中 Calendarific/manual 的有效最终事实继续保留；manual 最终记录仍高于新 official，Calendarific 最终记录与新 official 冲突时按既有 official 优先级展示，但 baseline 本身不被冒充为 Calendarific 原始快照；
6. 只有该 country/year 的所有活跃来源均已通过各自获授权的完整快照初始化，或由用户明确批准退休，且 hybrid 与纯来源重建差异已审计，才允许事务性切换为 **source-only projection** 并停止读取该单元 baseline；
7. 初始化失败或事务中断时，baseline、旧业务投影、旧 coverage/applied 状态保持不变；失败来源保持 uninitialized/due，不产生删除；
8. 初始化是来源级动作，不是隐藏的 Provider 刷新。official 本地候选可离线初始化；Calendarific 等网络来源只有在另有真实调用授权、最大请求数、额度依据与停止条件后才能初始化。无授权时保持 uninitialized + hybrid，调用数必须为 0。

`calendar_legacy_projection` 可在全部单元安全切换后保留到明确的清理审批；本提案不授权删除。若用户不批准 baseline 表，则不得从旧合并库直接启用 source-only 重建。

### 5.10 代码回退与再次升级

#### 推荐方向：迁移后数据库只允许旧代码只读

旧代码不知道 `calendar_source_events`、snapshotState、writer epoch 或原子 source snapshot API。允许它继续执行 Runtime、手工刷新或 Repository Calendar 写入，会更新 `calendar_events/settings.calendarSync` 而不更新来源表，使 applied revision 看似可信但实际已经分叉。因此默认合同是：

1. 已迁移数据库回退到旧二进制时，数据库必须以 SQLite/文件系统可验证的只读方式打开；仅设置 UI 文案、环境标志或“约定不点同步”不算隔离；
2. 禁止旧代码上的 background Calendar Runtime、`POST /api/shipping/calendar/sync`、`syncCalendarEvents`、seed/import 及任何 `upsertCalendarEvent/deleteCalendarEvents/saveSettings(calendarSync)` 写入口；只读 GET 可继续读取旧合并投影；
3. 若旧版本无法以技术手段保证该数据库只读，则禁止原地回退。需要旧版可写运行时，应使用升级前备份/克隆的独立数据库路径；迁移后的数据库保持封存，不得与旧版写入合并；
4. 新版本每次原子 Calendar 提交记录 `calendarWriterEpoch` 和 `projectionFingerprint`（规范化计算 `calendar_events + calendarSync` 的业务相关内容）。再次升级/启动时先比对；不匹配即 `rollback_diverged`，所有相关来源快照标 invalidated，禁止用旧来源表覆盖当前投影或推进 applied 版本；
5. 如果发生了不受支持的旧代码写入，恢复流程只能先封存当前投影为新的 legacy baseline，再按来源逐项重建可信快照；需要网络的来源仍须单独调用授权。不能依据旧 applied 字段跳过初始化；
6. 使用升级前可写克隆运行后再次升级，视为一次新的首次升级：创建新的 baseline，来源状态 uninitialized，不复用另一数据库中的 applied revision；
7. 回退/再次升级不得自动删除新表、baseline、保留数据库或历史失败证据。

这一限制覆盖 Runtime、手工刷新 API 和所有 Calendar Repository 写入口，而不是只关闭后台 job。若未来希望“旧代码可写且平滑再升级”，必须另提双写/变更日志兼容方案；不在本提案内。

## 6. 方案比较

| 方案 | 优点 | 风险/成本 | 建议 |
| --- | --- | --- | --- |
| A. 版本化人工官方数据集 | 无运行时网络、无 Secret/新依赖；能表达 pending/修订；容易双人复核 | 每年需人工跟踪；需维护清单和校验 | **推荐首批** |
| B. 六国官方公告自动解析 | 可减少重复录入 | 六套页面/PDF差异大，条款与稳定性不明；新增 parser/Provider、联网失败面与维护负担 | 不批准首批；逐国另提 Level 2 |
| C. 分国混合 | 稳定机器接口国家可自动，其余人工 | 当前未确认任何满足许可、稳定性和结构要求的官方免费 API | 作为未来目标，仅在逐国证据充分后审批 |

## 7. 预计涉及模块与文件（仅预测，不是实施授权）

- 获批实施后新增 `server/data/calendar/official/manifest.json` 与届时逐项批准的 country/year 数据文件；
- `shared/calendar.ts`：新增三轴 coverage、版本字段、cell/source requirement 与兼容派生规则；
- `server/providers/calendar.ts`：Official Provider 接收显式 dataset/coverage，Composite Provider 支持按来源选择性执行；不联网；
- `server/runtime/calendar-sync-job.ts`：按 `country/year/sourceId` 判 due、分来源调度、版本失效与 last-known 保留；
- `server/runtime/registry.ts`：按届时获批准的静态声明注册 configured identity，不因数据校验失败丢失 requirement；校验层只决定候选/受控失败，并传递 requirement/selection 合同；
- `server/shipping-store.ts`：把当前“incoming 先合并再保存”改为调用 Repository 原子 source snapshot 应用；业务读取仍取得合并投影；
- 新增 migration（编号由实施时基线决定）：增加 `calendar_source_events` 来源事实表、`calendar_legacy_projection` 首次升级 baseline（或经 ADR 确认的等价结构）及 Calendar writer generation/fingerprint 状态；这是明确待批准项；
- `server/database/shipping.ts` 或实际 settings Repository 边界：提供单事务 `applyCalendarSourceSnapshot`，原子保存来源事实、合并投影、三轴 coverage 和 applied revision/hash；
- 数据库启动/部署运行手册：定义迁移库的 writer contract 检查，以及旧代码回退时 SQLite URI/文件权限层面的只读启动；具体可行机制须在批准后离线验证；
- `server/api/shipping/calendar.get.ts`：返回业务完整性、装载、刷新和操作错误的分离 DTO；
- `server/providers/calendar.test.ts`、`server/runtime/registry.test.ts`、`server/runtime/calendar-sync-job.test.ts`：真实生产组合的离线回归；
- `src/components/shipping/pages.tsx`：三轴状态、partial/pending、last-known 及范围免责声明；
- `docs/status.md`、`docs/architecture.md`、`docs/plans/shipping-hot-v3-real-data.md`、`AGENTS.md`：实施与验证完成后才同步实际状态；必要时更新 ADR-004/ADR-005 或新增数据治理 ADR。

本提案明确包含 Calendar Provider/cache 核心接口、共享 DTO、JSON coverage 内容，以及 `calendar_source_events`、legacy baseline、writer generation/fingerprint 所需的 additive migration。预计不新增网络 Provider、依赖、SDK、Secret 或认证变化；正常前向运行不改变部署拓扑，但代码回退需要一个可验证的数据库只读启动/文件权限流程，该运维变化也须批准和验证。schema 未获单独明确批准前不得实施。

## 8. 分批实施边界与验收标准

### 8.0 Change Contract（仍待批准）

- Purpose：在不扩大业务范围的前提下补入有一手证据的六国全国日历，并避免部分配置、正常 pending 或本地版本更新连带刷新 Calendarific。
- Change level：Level 2 + 单独 schema approval gate；改变 Calendar cache requirement、Composite Provider 调度、共享 coverage/API DTO、JSON coverage 内容，并新增来源事实、首次升级 baseline 和 writer generation/fingerprint 持久化。
- Allowed scope：第 2.1 节全国口径；本地人工官方数据集；按 `country/year/sourceId` requirement；按来源选择性执行；三轴状态和版本失效。
- Protected boundaries：Vite + React + Nitro + db0 模块化单体；UI/GET 不外呼；Real/Mock 隔离；last-known、provenance、计数与双年份独立判断；Calendar `COVERAGE_PENDING`；历史 P7。
- Compatibility：保留现有 `CalendarCoverage.status` 作为派生兼容字段；旧成功 coverage 按第 5.8 节合成 legacy applied 版本并继续依 TTL 判断，旧失败/unknown 仍 due；现有 API 消费方在兼容期仍可读取原字段，新 UI 使用新增字段。
- Persistence：coverage/版本使用现有 settings JSON，可选字段需兼容；来源完整事实和 legacy baseline 使用新增持久化结构；所有新版本 Calendar 写入由一个 Repository transaction 原子提交。
- Rollback：已迁移数据库只允许旧代码以 SQLite URI/文件权限等经验证的技术手段强制只读；具体机制若在现有启动路径不可行，则禁止原地回退。若需旧版写入，必须使用升级前独立克隆。再次升级先校验 writer generation/fingerprint，分叉则作废来源快照可信度并重新 baseline，不得让旧来源表覆盖新投影。
- Required verification：本节各 Batch 的定向场景、完整离线测试/typecheck/lint/build、`git diff --check`、独立 Bugbot、人工数据复核和 Neat Freak；未运行项标 pending。
- Explicitly out of scope：自动抓取、TH 银行业接入、地方/州级、港口停运推断、新网络 Provider/依赖/Secret、**除本提案明确列出的来源事实表、legacy baseline、writer generation/fingerprint 之外的 schema 变化**、JMA、商业船期、Translation、性能修改。

### Batch 0：证据封存与口径确认

范围严格限定为公开官方原件取证：固化原始链接/文件、哈希、发布机构、发布日期、适用范围、修订/撤回状态和自动读取/复用条件；解决 MY 2027 直接原件、TH 全国列表、VN 2026 法律新增项等现有证据缺口。Batch 0 **不授权编写代码、创建业务数据集、导入事件、调用真实 Provider 或操作数据库**。

完成标准：

- 12 个 country/year 都有唯一证据状态；没有可靠原件时为 `evidence_pending`，不用搜索摘要或检索未命中证明完整/未发布；
- 所有 complete 候选有可打开的一手原件、公告编号和完整性说明；
- pending 不生成假日事件；
- 记录复用条款是否明确，无法确认时保持 pending；
- Data owner、Maintainer、人工 Reviewer 的责任角色已定义；具体人员未指定前明确标 `待确认`，AI/Bugbot 复审不冒称双人人工复核完成。

Batch 0 完成后仍需用户批准第 5 节 Level 2 合同，才能进入任何后续实现。

### Batch 1：2026 全国官方数据集

范围：仅批准候选的全国公共假日、全国特别/替代休假和官方补班调休。候选国家为 CN、ID、MY、PH；VN 仅在 Batch 0 组合核验完成后另行确认加入。TH 银行业日历及地方/州级/行业数据均不接入；TH 全国数据在原件核验与另行确认前保持 `evidence_pending/not_configured`。

完成标准：

- 正常、空数据、部分失败、全失败、缓存命中均离线验证；
- Runtime → SQLite（独立临时库）→ Repository → API → UI 可追溯 source/evidence；GET 不触发外部请求；
- 补班/替代休假、同日去重、跨国/跨年边界正确；
- official 缺失/陈旧/失败阻止全缓存跳过，成功国家数据不丢失；
- 第二轮缓存命中 official 和 Calendarific 均 0 调用，历史 Runtime 证据不变；计数合同不退化；
- **部分装载永久-miss 回归**：仅配置 CN 2026，其他 11 个单元为 `evidence_pending/not_configured`；固定时钟连续运行两轮，首轮按需同步，第二轮不得因其他 pending 单元调用 official 或重复请求仍新鲜的 Calendarific；
- 已配置的 `confirmed_partial/not_published` 可在装载成功且版本/TTL 新鲜时停止重复刷新，但 UI 仍显示业务不完整；已配置但 missing/stale/validation_failed 必须保持 due；`confirmed_empty` 必须有证据且 0 events 时仍可 fresh；
- **版本回归**：七日 TTL 内只提升 CN 2026 official revision/hash，进程重启后识别 desired ≠ applied，仅重跑 CN 2026 official，Calendarific 调用为 0；成功后保存新 applied 版本；新版本校验失败时旧事件和旧 applied 版本不变并显示 last-known/失败；修复后可重新应用；
- **coverage 隔离**：official 单独更新后，Calendarific coverage、检查时间、版本和失败证据深度相等；下一轮 Calendarific 调用仍为 0。Calendarific 单独更新后，缓存 official/manual 来源事实、coverage、evidence 和 `manual > official > third-party` 合并优先级不变；
- **删除隔离**：单一来源的授权撤回只删除该 source/cell 原始事实并重算投影；partial 或部分失败不删除该来源未返回的 last-known，也不删除其他来源有效事实；未执行来源空结果没有删除权；
- **Registry 失败**：已配置数据文件缺失、格式错误、哈希错误均保持相同 requirement/identity 并产生受控失败，不降级为 placeholder；单文件损坏不影响其他 official 单元或 Calendarific/manual/Mock；manifest 整体损坏使静态声明的 official 单元失败但不泄露文件内容。修复后同版本可恢复，last-known 与旧 applied 版本在成功前不变；
- **兼容**：旧 Calendarific/manual/Mock 成功 coverage 在 TTL 内不会因缺少新字段反复同步；placeholder 仍非 required；旧式 Provider 作为不可拆分执行组，行为可回退且不会冒充选择性来源；
- **事务故障注入**：在来源事件/合并事件已写入、coverage/applied revision 保存前抛错，验证整个事务回滚——事件、coverage、检查时间和 applied 版本均为旧值；失败后重启仍识别同一 desired ≠ applied，以同版本重试；成功重试仅应用一次，重复应用相同 revision/hash 无重复记录、无额外删除且计数符合本轮合同；
- **首次升级**：旧库含 fresh Calendarific/manual coverage 和二者合并事件，migration 后 `calendar_source_events` 为空、两来源 snapshotState 为 uninitialized、legacy baseline 与原投影哈希一致；仅离线应用 official 后，旧有效 Calendarific/manual 最终事实仍存在，manual/official/third-party 优先级和 evidence 不退化，未授权 Provider 调用总数为 0；
- **部分初始化**：official 成功、manual 初始化失败、Calendarific 未获网络授权时保持 hybrid projection，不能切换 source-only 或删除 baseline；进程重启后状态、投影和 applied 版本一致，同版本重试幂等；只有全部活跃来源初始化/明确退休且差异审计通过后，才原子切换 source-only；
- **代码回退/再次升级**：新版本完成一次原子写入后回退，验证已迁移数据库对旧代码为技术只读，后台 Runtime、手工 sync API、store/repository Calendar 写入口全部失败关闭而 GET 可读；如改用升级前可写克隆，旧代码写入只发生在克隆。再次升级迁移库 fingerprint 一致则继续可信，升级克隆则重新 baseline/uninitialized；模拟违规旧写导致 fingerprint 不一致时，来源快照变 invalidated，禁止覆盖投影或伪造 applied，恢复不触发未授权网络调用；
- UI 明示全国 scope 与“不代表港口停运”。

### Batch 2：2027 经 Batch 0 原件核验的部分

范围：先处理 MY（原件核验后）；其他国家只在正式原件核验、内容复核和用户逐国确认后加入。TH BOT 银行业日历不接入 Batch 2，只保留为调研参考。

完成标准：每个国家独立达到 Batch 1 同等标准；未取得正式原件的国家保持 `evidence_pending/not_configured`，不能因部分国家完成而宣称六国双年完整。

### Batch 3：地方/州级或自动解析（另行审批）

只有明确重点港口行政区、可靠 subdivision code、维护收益和来源条款后才提案。自动解析器逐国评审，设置最大请求、缓存、失败保留、版式变化检测和停止条件；不得一次批准为“全球/全地方覆盖”。

Batch 1 之后的实施批次均须按“实现 → 离线验证 → 独立 Bugbot 复审 → 完整检查 → Neat Freak Closeout”闭环。AI/Bugbot 的代码复审与人工逐条核对官方原件是两种不同门槛，不能互相替代。真实来源核验若需要联网，应先声明来源、请求上限、免费/许可依据和停止条件。

## 9. 维护责任建议

- Data owner：确认业务 scope 和 complete 判定；行业/地方数据不在本提案范围；
- Maintainer：每年 8–12 月按国家跟踪下一年度公告，保存原件/哈希，录入候选；
- Human Reviewer：由不同于 Maintainer 的人员逐条对照官方原件，确认公告编号、日期、地域、替代/补班关系和修订；
- Runtime owner：只负责数据合同、缓存和失败保留，不替代内容审查。

上述均为责任角色，具体人员当前均为 **待确认**。独立 Bugbot 只复审代码与合同实现，不能被记录为 Human Reviewer，也不能证明业务数据完成双人人工复核。

发生修订时在一个工作日内建立新候选版本；未完成独立复核前保持旧 last-known 并将 coverage 标 partial/stale，不静默替换。

## 10. 待用户明确批准

1. 是否批准首批“全国公共假日 + 全国特别/替代休假 + 官方补班/调休”，并明确排除全量地方/州级和港口停运推断；
2. 是否批准 Level 2 推荐合同：按 `country/year/sourceId` 生成 requirement，并让 Composite Provider 只执行 due 的来源/单元；不采用单独的“仅单元 requirement”或“仅来源隔离”半方案；
3. 是否批准三轴 coverage/DTO：业务完整性、装载状态、刷新状态分离，正常 pending 不算 operational failure；
4. 是否批准按第 5.3、5.9、5.10 节实施 additive migration：新增 `calendar_source_events`、首次升级 legacy baseline 及 writer generation/fingerprint 状态，保留现有 `calendar_events` 为合并投影；若不批准，则不启用选择性来源同步；
5. 是否批准 Repository 单事务应用来源事实、合并投影、coverage 与 applied revision/hash，并在现有 coverage JSON 中增加三轴状态、版本和 attempt/success 时间；
6. 是否批准采用版本化、双人人工复核的本地官方数据集，复用现有 Official Provider 职责和统一 `official-holiday-source` provenance，不新增网络 Provider；
7. 是否批准 Batch 0 仅开展公开原件、哈希、范围、修订和复用条件核验，且完成后仍不得自动进入代码/数据接入；
8. 指定 Data owner、Maintainer、Human Reviewer 和 Runtime owner；未指定前均保持待确认，AI/Bugbot 不替代人工复核；
9. 是否批准代码回退限制及配套运维验证：迁移数据库只允许旧代码以 SQLite URI/文件权限等技术手段只读；若现有启动路径不能保证则禁止原地回退；旧版可写只能使用升级前独立克隆，再次升级按新首次升级处理；
10. 确认 TH 银行业数据不进入 Batch 1/2；自动解析、地方/州级、任何新网络 Provider/依赖/Secret 或超出本提案明确列举结构的 schema 均另行审批。

在上述事项获明确批准前，本方案保持 `proposal / awaiting approval`，不进入实现。
