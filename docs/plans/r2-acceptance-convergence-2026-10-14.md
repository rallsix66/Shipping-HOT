# R2 原验收收敛与来源映射建议 — 2026-10-14

> Historical read-only findings below were accurate at8707019. Wiring/adaptive gaps are now addressed by `e5d2f0bb0aa4651984d69d280db0c2485d9467a2`; upstream actual44578fa found in local packs, formula/bounds adapted, default remains off. This does not approve pending classification/denominator/network/24h proposals; use docs/status.md for current implementation.

状态：**PROPOSAL / NOT_RUN（公开核查与24h未执行）**。本轮仅只读代码与校正文档；不得把此文当作联网、生产启用、付费、迁移或分母变更授权。权威标准仍是9.29原计划，≥80%/100%不改。代码检查基线 `8707019a74ac81a698d303d852a40b3c13bed489`，既有门禁证据 `docs/evidence/gate-8707019-frontend/`；本轮未重跑功能全量。

## 1. 原条款 → 证据 → 真缺口

此前status把额外限制混入R2-1/2/3通关条件，现纠正。下列证据来自具体代码/测试及既有干净SHA日志，不是标称状态。

### R2-1

> R2-1 单元测试覆盖：RSS、Atom、RDF；`web_list`（包括“年月日”写法、佛历、`dd/mm/yyyy`、不带时区的日期）；`json_list`；GBK、TIS-620、windows-1258 编码；URL 规范化；内容修订；配置白名单。

- 代码/既有测试：feed.test.ts、article-fetch-security/transport.test.ts、web-list/json-list及collect测试；8707019全量1150/3日志覆盖；79fc6c8产品许可修复已限定复审。
- 确实缺口/边界：原指定单元条款已有离线证据；真实来源配置/原页不足归R2-4/5，不追加到R2-1。若逐项复审找到遗漏再离线补，不为刷覆盖重复整链。
- 路径：原单元复审可离线。

### R2-2

> R2-2 SSRF 防护：访问私网地址被拒绝，经跳转到达私网地址也被拒绝；按信源配置的 CA 只对该信源生效（测试）。

- 代码/既有测试：article-fetch-security.test.ts私网/跳转；article-fetch-transport.test.ts分源/分host CA、重选信任及拒绝非法CA；8707019全量。
- 确实缺口/边界：原测试条款已有证据；实网TLS握手/全部源CA有效性不属于此条新增硬门槛，只作为实网运行限制。
- 路径：离线测试已有；实网另授权。

### R2-3

> R2-3 回执幂等：请求已发出后超时，重启后**不会重复付费**；预算设为 0 或没有配置时，一次都不调用（测试）。

- 代码/既有测试：receipts.ts/test.ts：zero/unconfigured budget零caller、发送后timeout unknown不重发、startup/stale pending及重启上下文用例；paid-budget.ts单一预算；8707019全量。
- 确实缺口/边界：测试名new process实际是同内存DB的新fake caller/context。已有重启语义断言，不宣称真实OS重启；如需补足持久重开证据可离线文件库close/reopen，不要求实付或进程压力。对账、分钟限流、unknown UI、实际硬收费上限不是本条新增通关标准。
- 路径：复审现有模拟证据边界；可离线增强原重启行为，无需真实付费。

### R2-4

> R2-4 **在实际运行环境中重新核查信源目录**：逐条记录 `OK / PARTIAL / BLOCKED / STALE` 并写回目录。P1 中的自动信源有 ≥ 80% 为 `OK`。

- 代码/既有测试：after-DNS六RSS、four-index既有公开快照及目录/原库存；不是此次执行。
- 确实缺口/边界：需在实际环境逐条核查并写回状态；41项保留，最终分类/分母待批准；≥80%未证明，旧DNS失败不覆盖后续成功。
- 路径：分类/分母用户决策；有界公开只读另授权。

### R2-5

> R2-5 离线夹具回放：用录制下来的真实页面测试，P1 自动信源 100% 能解析出标题、链接和时间。

- 代码/既有测试：TH/BMKG/NCHMF存档子检查、TMD原字节及8707019 Runtime→GET→SSR链；原HTML冲突fail-closed单测。
- 确实缺口/边界：100%标题/链接/时间的真实页回放仍缺多源原始材料/正确绑定；Northport关联FAIL、原DOM0保留。运营/付费/向量如何映射不能自行豁免。
- 路径：许可/契约用户决策；有原始材料可离线回放，缺材料的采集另授权。

### R2-6

> R2-6 没有重复的机制：代码里没有第二套任务调度、预算表或 RSS 解析器（在审查中逐项确认）。

- 代码/既有测试：registry/BackgroundRuntime/paid-budget/既有feed.ts；8707019测试复用同一job及parser。目录盘点只是枚举。
- 确实缺口/边界：局部代码检查未发现本轮第二机制；全阶段审查逐项确认仍需收尾，不能拿audit-inventory脚本当安全审计。
- 路径：只读审查可离线，无需再建机制。

### R2-7

> R2-7 人工录入：粘贴链接和正文后，AI 能自动填好字段（R3 接入模型之前，先用纯手动表单验收）；保存后能正常入库，并标为“官方通知（人工录入）”；检查清单能显示每个信源的建议查看频率和上次查看时间。

- 代码/既有测试：79fc6c8产品许可/历史身份修复已限定复审关闭；manual POST/GET/native/SSR、检查频率/时间、unknown发布时间；8707019全量。
- 确实缺口/边界：R3前纯手动例外原文允许；不要求现在AI填字段。真实页面操作尚未验证，SSR不替代实际交互。未知许可仍metadata-only。
- 路径：已有实现；浏览器可用后验证原用户流程，不另加实付/AI门槛。

### R2-8

> R2-8 受控的真实运行（需要用户授权）：P1 信源连续跑 24 小时，失败的信源能自动退避并标记为 `failing`。结果记录到 `docs/live-verification.md`。

- 代码/既有测试：intel-bootstrap.test.ts自动到期/退避/所有权与8707019五次离线任务。
- 确实缺口/边界：真实24h未跑；生产接线/全P1配置未齐备。固定成功间隔是否足够满足原自适应条款尚待明确，见下一节。假钟/五次runNow不是24h。
- 路径：先补原实施缺口（离线），后明确真实运行授权。

## 2. 自适应频率、退避、生产接线实际代码

原实施条款：“定时任务：信源调度、自适应抓取频率、失败退避，都注册为现有 BackgroundRuntime 里的任务。”这些实施要求不是从额外风险限制推导出来的新验收条件。

| 部分 | 当前代码事实 | 结论/下一步（未实施） |
| --- | --- | --- |
| 调度 | intel-collect-job注册现有Runtime，15min job tick；listDueSources基于next_sync_at；默认关，测试可注入 | 已有框架/离线到期证据，不能称生产已启用 |
| 成功频率 | collect.ts成功一律now + seed.intervalMs；没有按新条目/空结果/变化趋势调整的独立成功分支 | 只证明固定成功间隔+失败退避。原文未指定自适应算法/上下限，不能自动要求新成功态控制算法；需按参考实现/用户澄清决定原要求是否还有实现缺口，然后才离线补，不新增通关条件 |
| 失败退避 | computeBackoffMs15min指数翻倍、24h封顶；source failing和fail_count；成功重置；run/source原子收尾 | 代码/单测已有，真实24h行为未验。例外storage_unavailable不冒充已成功保存 |
| 数据库源开关 | 当前仅已有正式TMD/BMKG种子；manual来源排除自动due。upsertSource每轮取seed.enabled写回；没有完整41源产品配置/运行选择 | 不能仅在DB把enabled改true当完整运行准备；也不能将R5暂停管理另加为R2硬门禁 |
| 生产入口 | Nitro plugin只调用bootstrap({installSignalHandlers:true})，无registry.intel；registry缺省seeds=[]/enabled=false，无fetch；启用需要fetch+seeds，bootstrap还要求acquireIntelOwnership | 真实接线未齐备。测试lease/mock transport不等于生产依赖。安全defaultTransport原语已有，具体DNS/传输/独占生命周期须复用现有边界显式接入，不建第二调度。默认关继续保留 |
| 费用边界 | receipt未知不自动重发、共享估算预算；尚无实际模型caller接线 | 原R2-3零调用/幂等与额外费用限制分开。真实模型接线属后续阶段，不因本轮无实付而新增失败条件 |

## 3. 41项P1自动库存逐项类型建议

使用既有库存41，manualP1 17和P2 40另存原材料不删除；本表不新增/删除目录、不改URL、不发布新分类。分组为普通资讯25、天气双重8、政策整页1、运营5、付费天气1、向量1。**41仍完整保留；N/A建议不等于PASS，也不自动缩分母。**

- 严格原文字面口径未改：R2-4 P1自动≥80% OK；R2-5 P1自动100%标题/链接/时间。应用原41口径时不能给非文章产品虚造标题/发布时间。
- 类型化口径是建议：逐项说明原阶段/契约；若用户接受将部分产品用数据契约或原阶段验收，必须同时明确分母/分子算法。未同意前覆盖率和批准分母为null，不报告通过率；不自动把5+1+1条排除成34，更不只算普通25。
- API文档页面HTTP200不是API调用/数据契约通过；有效期、预报时段、模型时间不是新闻发布时间。缺时间保留未知，不用抓取时钟替代。
- 目录含混合URL/模板/文档时保留原文本；实际请求端点/参数必须单独批准，不能把模板或说明串直接当请求URL。

| ID | 建议类型与验收字段 | 原阶段/理由（均不自动豁免） | fixture保存计划 |
| --- | --- | --- | --- |
| CN-P01 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| CN-P02 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| CN-W01 | DUAL：标题/链接/时间 + 独立天气数据契约 | R2资讯条款不自动豁免；预警有效期/区域/路径属R1.5，不冒充发布时间或港口影响；依据 9/29 §4.8及§6 R1.5-1/2/3；ADR008 §2 Official alerts/Tropical cyclone；R2-4/5原文未分域 | 保留已有NMC原页；当前intel缺detail锚点/日期语义，不得由运营解析成功代替资讯通过 |
| CN-W02 | DUAL：标题/链接/时间 + 独立天气数据契约 | R2资讯条款不自动豁免；预警有效期/区域/路径属R1.5，不冒充发布时间或港口影响；依据 9/29 §4.8及§6 R1.5-1/2/3；ADR008 §2 Official alerts/Tropical cyclone；R2-4/5原文未分域 | 保留已有NMC原页；当前intel缺detail锚点/日期语义，不得由运营解析成功代替资讯通过 |
| CN-T01 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| CN-T02 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| VN-P01 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| VN-P03 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| VN-W01 | DUAL：标题/链接/时间 + 独立天气数据契约 | R2资讯条款不自动豁免；预警有效期/区域/路径属R1.5，不冒充发布时间或港口影响；依据 9/29 §4.8及§6 R1.5-1/2/3；ADR008 §2 Official alerts/Tropical cyclone；R2-4/5原文未分域 | 保留现有NCHMF存档及明确的fixture-only日期规则；原告警/资讯时间契约分开 |
| VN-T01 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| VN-D01 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| TH-W01 | DUAL：标题/链接/时间 + 独立天气数据契约 | R2资讯条款不自动豁免；预警有效期/区域/路径属R1.5，不冒充发布时间或港口影响；依据 9/29 §4.8及§6 R1.5-1/2/3；ADR008 §2 Official alerts/Tropical cyclone；R2-4/5原文未分域 | 现有完整CAP XML可按既有public-domain产品许可复用，原字节/响应元数据/哈希保留 |
| TH-C01 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| TH-C02 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| MY-P02 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| MY-P03 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | Northport关联FAIL保留；原DOM0。需获准原始结构材料后再验证，元数据派生物不冒充原页 |
| MY-W01 | DUAL：标题/链接/时间 + 独立天气数据契约 | R2资讯条款不自动豁免；预警有效期/区域/路径属R1.5，不冒充发布时间或港口影响；依据 9/29 §4.8及§6 R1.5-1/2/3；ADR008 §2 Official alerts/Tropical cyclone；R2-4/5原文未分域 | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| MY-C01 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| MY-T01 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| MY-L01 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| ID-W01 | DUAL：标题/链接/时间 + 独立天气数据契约 | R2资讯条款不自动豁免；预警有效期/区域/路径属R1.5，不冒充发布时间或港口影响；依据 9/29 §4.8及§6 R1.5-1/2/3；ADR008 §2 Official alerts/Tropical cyclone；R2-4/5原文未分域 | 已有旧BMKG存档但需注明/en与/rss.xml差别；新产品仅既有excerpt许可，不保存未授权完整XML |
| ID-W02 | OP：运营数据契约（建议，待批准） | 原R1.5/§4.8产品：非文章列表；不能造标题或文章链接使R2-5通过；不从41自动减去；依据 目录ID-W02；9/29 §4.8海况及R1.5-1；ADR008 §2 Land+marine | API原数据/字段时间/单位/缺测/产品URL与参数；权限未明确不保存完整响应 |
| ID-T01 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| ID-T02 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| PH-P01 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| PH-W01 | DUAL：标题/链接/时间 + 独立天气数据契约 | R2资讯条款不自动豁免；预警有效期/区域/路径属R1.5，不冒充发布时间或港口影响；依据 9/29 §4.8及§6 R1.5-1/2/3；ADR008 §2 Official alerts/Tropical cyclone；R2-4/5原文未分域 | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| PH-W02 | DUAL：标题/链接/时间 + 独立天气数据契约 | R2资讯条款不自动豁免；预警有效期/区域/路径属R1.5，不冒充发布时间或港口影响；依据 9/29 §4.8及§6 R1.5-1/2/3；ADR008 §2 Official alerts/Tropical cyclone；R2-4/5原文未分域 | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| PH-C01 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| PH-M01 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| XX-W01 | OP：运营数据契约（建议，待批准） | 原R1.5/§4.8产品：非文章列表；不能造标题或文章链接使R2-5通过；不从41自动减去；依据 9/29 §4.8 JMA targetTc/forecast及R1.5-1；ADR008 §2 Tropical cyclone | API原数据/字段时间/单位/缺测/产品URL与参数；权限未明确不保存完整响应 |
| XX-W02 | OP：运营数据契约（建议，待批准） | 原R1.5/§4.8产品：非文章列表；不能造标题或文章链接使R2-5通过；不从41自动减去；依据 9/29 §4.8 JMA targetTc/forecast及R1.5-1；ADR008 §2 Tropical cyclone | API原数据/字段时间/单位/缺测/产品URL与参数；权限未明确不保存完整响应 |
| XX-K01 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| XX-K02 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| XX-K03 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| XX-M01 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| XX-M03 | NEWS：标题/原文链接/时间 | R2原条款直接适用；不能以HTTP200替代正确关联和时间语义；依据 9/29 §6 R2-4/5；ADR008 §2 Intel RSS/web/json/manual | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |
| XX-A01 | OP：运营数据契约（建议，待批准） | 原R1.5/§4.8产品：非文章列表；不能造标题或文章链接使R2-5通过；不从41自动减去；依据 9/29 §4.8及R1.5-1；ADR008 §2 Land+marine及§4 Attribution/licensing | API原数据/字段时间/单位/缺测/产品URL与参数；权限未明确不保存完整响应 |
| XX-A02 | OP：运营数据契约（建议，待批准） | 原R1.5/§4.8产品：非文章列表；不能造标题或文章链接使R2-5通过；不从41自动减去；依据 9/29 §4.8及R1.5-1；ADR008 §2 Land+marine及§4 Attribution/licensing | API原数据/字段时间/单位/缺测/产品URL与参数；权限未明确不保存完整响应 |
| XX-A03 | PAID：付费天气产品契约/权利（建议，待批准） | §4.8/ADR008的上线许可决策；无key/预算不调用。建议原R2资讯条款不适用，需用户确认计数；依据 9/29 §4.8上线前决定是否购买；ADR008 §2/§4 | 原阶段材料；不调用收费API/模型，不保存密钥，URL仅作为目录原文本保留 |
| XX-A04 | VECTOR：向量维度/输入限制/模型绑定/预算回执（建议，待批准） | 原R3-1/5服务，URL是文档非资讯/调用端点。建议原R2资讯条款不适用，不能用文档HTTP200充数；依据 9/29 §4.10、§6 R3-1/R3-5及已选Bailian；ADR007绑定/付费边界、ADR008 §2 Embeddings | 原阶段材料；不调用收费API/模型，不保存密钥，URL仅作为目录原文本保留 |
| XX-F01 | POLICY：政策页标题/URL/明确发布或更新时间；全页/段落版本另列 | R2可采集元信息；全页差异为R3-8，页面更新/生效日与发布时间分开；依据 目录§9b；9/29 §4.11和§6 R3-8（TikTok整页新增段落夹具） | 仅元数据派生物可先保存；真实原页/合法原始片段的复制许可需产品级确认，不能把metadata_only扩大到整页 |

完整目录URL原文本和分组计数：`docs/evidence/r2-acceptance-convergence-2026-10-14/mapping.json`。分类不是新增硬门槛；为了说明如何兑现原条款，不是任意移除天气、付费或向量。

## 4. 真实页fixture保存与脱敏

1. **既有获准材料先复用**：TMD2026-10-10原XML及after-DNS确切CAP原XML，保留来源URL、HTTP/charset元数据、capture时间、原字节hash、许可依据。BMKG旧/en与当前/rss.xml区分；NCHMF/NMC专属警告解析不等于intel普通资讯解析。衍生元数据不充原页。
2. **许可未明确的原完整响应只在内存**：不能因为同域/官方/HTTP200就新增整页保存。磁盘只存合法标题、原链接、原日期/时区/语义、少量获准摘录、结构观察与哈希。`metadata_only`不能保存整页HTML/完整RSS/JSON，`excerpt_only`不能保存全文。
3. **真正可回放原结构需产品级许可**：优先只含标题/锚点/日期的公开索引原始字节或获准真实片段，保留编码与上下文。片段/脱敏文件明确不是完整原页；能否满足R2-5需相应复审，不自动记PASS。无许可的原页fixture缺口继续保留。
4. **落盘前检查**：不发送凭据/Cookie，不保存Authorization/Set-Cookie/会话key/签名URL/嵌入凭据。Headers只保存Content-Type/Content-Length/Content-Encoding等安全白名单，异常值不输出/不测试。候选原字节若含敏感内容，先停止保存，记录代码和hash；确需脱敏时保存变化清单、原/脱敏hash和标记，不能声称脱敏后仍是原始字节。历史存档未全面清理，不宣称账户泄露或全库洁净。
5. **每条manifest**：干净code SHA、catalog_id、原URL/最终URL、capture UTC、HTTP状态、mime/charset、原字节大小/hash、采集/解析命令raw exit及stdout/stderr、许可范围、真实/合成标签、日期规则、正/空/失败类型。空有效结果不是包含正样本；发表日期和生效/有效期分开。
6. **Northport**：关联FAIL不撤销。获得原DOM前只保留旧失败；后续真实fixture必须断言同一节点中的title/link/date绑定、重复URL冲突fail-closed，不能仅用条目数/HTTP200判通过。

## 5. 下一次有界公开只读核查建议（未请求授权、未执行）

目的：补未有原结构的P1公开索引观察，并复核Northport/Thai字段；不是重跑相同六RSS，也不自动达到≥80%/100%。若许可仍未明，此批只产元数据，原fixture缺口仍在。运行前需明确批准此6个URL的访问及各产品保存范围。

| ID | 精确目录URL | 请求上限 |
| --- | --- | --- |
| CN-P01 | `https://www.gd.msa.gov.cn/` | 1 GET |
| CN-T02 | `https://szs.mof.gov.cn/zhengcefabu/` | 1 GET |
| VN-P01 | `https://vimawa.gov.vn/vi/thong-bao-hang-hai` | 1 GET |
| PH-C01 | `https://customs.gov.ph/category/media-releases/` | 1 GET |
| MY-P03 | `https://www.northport.com.my/np/page-announcements.html` | 1 GET |
| TH-C01 | `https://www.customs.go.th/list_strc_simple_with_date.php?ini_content=customs_news&ini_menu=menu_public_relations_160421_04&order_by=date&sort_type=0&lang=th` | 1 GET |

- 全批最多6次实际HTTP，逐源一次、并发1、每响应512KiB（解码前字节限）、每次10s，全批120s；redirect/detail/pagination/retry均0。GET之前持久化reservation，连接中断/未知结果不自动重发。失败照样记完整证据，不补URL或换出口。
- 只用已有安全边界：HTTPS、域名白名单、系统解析的公共地址固定、私网/特殊地址阻断、不降级/不绕TLS；不改DNS/代理/TUN/allowlist/全局CA。CN-T01当前目录HTTP不在此批，不悄悄改HTTPS；付费/向量/模板API不在公开批，但仍留41库存。
- 无LLM/付费/凭据/Cookie/浏览器自动化；无后台任务、生产开关或保留库写入。全部探测/解析在一次性隔离内存或.tmp库；生产配置不更新。只写获准元数据证据，绝不默认收全文。
- 字段观察、可达性、解析成功、真实关联、内容年份与目录OK/PARTIAL/BLOCKED/STALE分开记录。通过必须符合目录原OK定义；HTTP200不等于OK。此建议自身状态NOT_RUN，不继承上次授权。

## 6. 24h尚需的最小准备

1. 批准41分类/计数口径，明确本次P1集合及不得省略的产品。原R2-8只写P1，manual源又明确不自动进入站点；授权时必须说明manual如何纳入检查记录，不能因此把manual自动抓取或悄悄排除。≥80%/100%保持原值，或任何解释变更需用户同意。
2. 每个进入运行的来源有已观察真实产品契约/准确URL、解析配置、许可保存范围；源自动采集状态与人工checked_empty分离。Paid/R3服务无预算/凭据时不调用，不伪装为公开源。
3. 先明确原自适应口径（不预设新成功态算法），并离线补真实bootstrap依赖接线和实际独占生命周期；复用同一Runtime/安全传输/数据库，不建第二机制。本轮没有实施它们，也不要求新迁移。
4. 新的显式授权写清来源、24h窗口/时区、频率/上限、允许保存的数据、停止条件与无付费约束。生产默认关不因文档变true；可先选授权隔离cwd/DB运行，不能启动仓库根dev写保留库。
5. 日志绑定实际干净SHA/环境/运行实例，逐源attempt/due/成功/空/失败/退避记录、起止时间/重启/运行历史及预算零调用证据；停机排空/所有权释放可复核。五次假钟任务不充24h。
6. 完成后按原R2-8写docs/live-verification.md；只读浏览/GET不触发抓取。无需为R2-1/2/3额外开启实付或新增TLS全站门禁。

这份文档不授权上述网络或代码工作；下一步应是针对真实缺口的具体决策/实现，不再无限重复已有离线完整链。
