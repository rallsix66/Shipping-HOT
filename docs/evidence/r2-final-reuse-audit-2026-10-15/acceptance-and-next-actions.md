# 原R2验收与统一收口

原文逐条与计划行号见[acceptance.json](acceptance.json)，[9.29现役计划](../../plans/shipping-hot-risk-intelligence-2026-09-29.md)未改。2026-10-14已获用户批准的分类是41保留/公开39/资讯34/数值5；不是本轮调整原门槛。以下PASS是历史证据只读复核或本地审计建议，**不代表本轮重跑产品门禁或自行完成主审封存**。

| 原项 | 本地审计判定 | 依据 | 真正剩余/边界 |
| --- | --- | --- | --- |
| R2-1 | PASS | 原指定单元合同已有覆盖；RSS/Atom/RDF、HTML/JSON、显式日期/unknown、编码、URL、修订、白名单。引用954c831既有全量日志，本轮未跑测试。 | 不把真实源100%配置/回放追加为本条条件；原实际来源缺口归4/5。 |
| R2-2 | PASS | 私网/跳转私网阻断与分源CA单元已有；保护沿既有secure fetch。 | scope仅该安全链/单测；实际源CA与真实TLS握手未验证，不新增全站握手门槛。 |
| R2-3 | PASS | 既有fake-caller测试：零/未配预算零调用、发送后超时unknown不重发、复用已收响应、启动恢复/过期模拟。 | “restart”用例是在同一测试DB重建caller/context，不冒充真实OS重启/实付验证；双连接测试也是同进程。通用业务caller未接；不新增实付/分钟限流/unknown UI门槛。 |
| R2-4 | FAIL | 批准口径41保留，公开自动39；25 OK /7 PARTIAL /1 STALE /2 BLOCKED /4 NOT_RUN，即25/39，至少32，差7。 | 14非OK逐源条件保留，必须获新的有界任务后才能复核；不靠HTTP200或本次文档审计提高分子。 |
| R2-5 | FAIL | 资讯/公告24/34，24 PASS /2 FAIL /1 PARTIAL /7 NOT_RUN；历史数值3/5独立，不冒充资讯字段全覆盖。 | 还差10源真实结构字段链。unknown日期不补造，缺href/同URL冲突不绕过；完整原件只在许可范围保存。 |
| R2-6 | PASS | 本次静态审计建议PASS：52行§5.3映射、唯一通用RSS/Runtime/月度预算决策且无第二预算/任务队列表。 | 仅本地审计结果/建议，主会话正式独立认可pending；不等于整份上游或整个R2已完成，collector cursor对应关系仍需裁定。 |
| R2-7 | BLOCKED | R3前允许纯手动；manualSubmit/检查清单/旧版本/精确产品许可及native/HTTP/SSR已实现、已有测试。 | 真实表单/键盘/宽度/浏览器交互及当前R2 GUI/S7未验。不得用SSR或旧S0–S8冻结S7代替；不新增本轮AI识别/真实付费条件。 |
| R2-8 | NOT_RUN | 实际连续24h未启动，当前生产选择只允许TMD/BMKG且默认off。 | 需要用户独立明确授权；2源观察只能覆盖2/39，不替代原P1全体要求。完整配置/选择范围扩展须另批，见只读提案。 |

统一结论 **R2 = BLOCKED**，其中4/5未达标为FAIL，7交互未验，8为NOT_RUN。R2-6没有第二机制可建议PASS，但完整§5.3并未全落地，未实施的R3–R5不因文件名缺失而提前创建；也不因为加了一个离线材料读取接口就提高源覆盖。

## 来源剩余动作

可用性14非OK如下；字段未PASS另为10源：CN-P02、CN-T01、VN-P01、MY-P03、MY-L01、PH-P01、PH-W01、PH-W02、XX-K01、XX-F01。所有条目以[当前矩阵](../r2-current-source-matrix-2026-10-14/mapping.json)为准，本轮不请求。

| ID | 可用性/资讯字段 | 最小前提；不等于请求授权 |
| --- | --- | --- |
| CN-P02 | PARTIAL / NOT_RUN | 需可证的不同官方目标；当前实测自指302不可重试/猜路径。 |
| CN-T01 | NOT_RUN / NOT_RUN | 需确认合规的官方HTTPS产品或另行协议决策；不放松安全、不猜URL。 |
| VN-P01 | PARTIAL / PARTIAL | 缺原日期字段/关联证据；10行不从抓取时间补造日期。 |
| MY-P02 | STALE / PASS | 需近期有标题的有效项；10原项/7空title/3有效，raw最高2026-09-28与有效最新2025-08-01并列。 |
| MY-P03 | PARTIAL / FAIL | 原同URL标题/日期冲突需来源澄清或明确规则；不能丢冲突项凑PASS。 |
| MY-L01 | PARTIAL / FAIL | 缺真实href身份，时刻格式需有原证据；不抓隐含接口、不虚构链接/时区。 |
| ID-W02 | NOT_RUN / NOT_APPLICABLE_NUMERIC | 需官方apidoc与港口KODE/精确产品映射，不把目录当数值JSON。 |
| PH-P01 | NOT_RUN / NOT_RUN | 需两URL产品范围与可验证、绑定到源的CA/结构；不改系统信任。 |
| PH-W01 | PARTIAL / NOT_RUN | 需有效官方正样本/实际身份时间字段；最新403/iframe不等于空列表。 |
| PH-W02 | PARTIAL / NOT_RUN | 需官方正样本、selector/时间规则与访问条件；不能以403作无事件。 |
| XX-W01 | BLOCKED / NOT_APPLICABLE_NUMERIC | 需官方当前精确产品依据；targetTc404不是空台风列表，不猜替代URL。 |
| XX-W02 | PARTIAL / NOT_APPLICABLE_NUMERIC | 需forecast/specification完整产品范围及数值证据，不因前提URL同一次404再请求。 |
| XX-K01 | BLOCKED / NOT_RUN | 需单独有界诊断，记录安全拒绝/实际响应或最小底层错误；不换工具绕过。 |
| XX-F01 | NOT_RUN / NOT_RUN | 需整页版本/日期段落/许可合同；不能当已配置list或自行抓正文。 |

## 决定顺序与权限

1. 主会话审查本次R2-6建议与**collector游标对应关系**：现有lastOkAt/成功run/nextSyncAt和去重已提供成功水位，上游独立cursor与RSS validator等未整移植。是否当前已批准的单页快照合同足够，或须最小补充，需明确裁定；本轮既不豁免也不实现。若选择新增持久状态/迁移，另取明确授权并沿同一collector/Repository，不能建第二套。
2. 用户决定是否继续有界源资格工作，明确选哪些ID、原URL/所需官方资料、许可与请求上限；14项不一次全部重试。要达到可用性至少32和资讯34/34仍须真实证据，不能用改分类、metadata空表或unknown补造过关。
3. 用户决定下一轮隔离GUI/手工操作验收范围；沿既有S7/系统Chrome方法，必要时只扩既有harness而不建第二套。当前前端交互未验，不能拿SSR或旧冻结S7直接盖章。本轮不启动预览、浏览器或S7。
4. 用户若选择24h，先审[最小两源提案](pilot-24h-proposal.md)与单次验收启动器/停止条件，再明确授权；全P1配置/选择允许范围另外批准，不能将两源试跑扩成39源结论。
5. R3通用模型/提示词/绑定、向量、分析消费者、评测及R4/R5留待用户阶段决定；不为这些未来工作继续造接口、运行真实LLM或建立新服务。

## R2-X（评估，不实现）

当前明确BLOCKED(JS) **0项已证实**：现BLOCKED是JMA精确404与Maersk未知传输，不是JS归因。PH-W01/02的403/iframe和MY-L01缺href只是待归因，不写成已证JS；ONE惰性JSON已由现有适配处理。零项已证不等于没有JS问题。无头浏览器增加进程/资源、依赖、抓取许可及安全审计成本，不能解决404、自指、CA、源字段空缺或冲突。目前没有依据自动开启新浏览器阶段，成本金额/站点收益未实测，不新增工具或网络探测。

本次审计/status推送PR8后停止新实现与信源请求，等主会话和用户下一阶段决定；不merge/deploy。
