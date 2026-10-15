# R2 后续执行交接 — 2026-10-15

接手先读取 [AGENTS.md](../../AGENTS.md)、[status](../status.md)、[现役计划](../plans/shipping-hot-risk-intelligence-2026-09-29.md)、[信源目录](../intel-source-catalog.md) 与 ADR-007/008/009。本文是短索引；逐源事实只以[当前41项矩阵](../evidence/r2-current-source-matrix-2026-10-14/mapping.json)及其[报告](../evidence/r2-current-source-matrix-2026-10-14/report.md)为准。

- 仓库 `D:\try one\Shipping HOT`，远端 `rallsix66/Shipping-HOT`。分支 `codex/shipping-hot-r2`，草稿 [PR8](https://github.com/rallsix66/Shipping-HOT/pull/8)，base `codex/shipping-hot-r1-5`；PR7未合并。这是已批准的临时堆叠，不切回main、不重建实现。
- 本轮源码/目录配置收尾起点 HEAD：`bebe1441465adfcabb9daf93cb2a8656ec1fc796`；真实ONE目标采集HEAD：`03d1515d33dd1c5d96137c43e0aafb596b334be3`；本轮已本地验证、待父审查配置代码：`bebe1441465adfcabb9daf93cb2a8656ec1fc796`（批准目录URL/关闭候选与一致性测试，245定向/1230全量+3跳过/3smoke；前01934a5内嵌JSON能力限定通过）。包含本交接文件的文档提交才是本轮后续 HEAD：接手运行 `git rev-parse HEAD`、`git log -1 --format=%H -- docs/handoffs/r2-next-execution-2026-10-15.md`，并核对 PR8 head；不要把采集起点或文档提交当成代码测试提交。
- 批准方案沿用 Vite/React/Nitro/db0/SQLite 单体、单 Runtime/parser/预算体系；优先未来自动采集。41项保留，公开39、资讯34、数值5，阈值至少32公开OK与34字段回放，不能删分母或自改标准。
- 当前覆盖21/39、18/34，数值有限历史诊断3/5单列；整体R2/24h未通过。11个页面候选默认关闭（10web_list mapper+ONE json_list HTML模式）；TMD/BMKG内置seed enabled=true与Intel生产job默认off分开，未授权开启、写持久化配置或运行24h。
- 前轮[ONE目录/候选落地](../evidence/r2-one-catalog-candidate-2026-10-15/report.md)：已批准目录URL现为https://www.one-line.com/en/newsroom，原/en/news的308及Location/前后目录hash保留。目录web_list指HTML页面；候选kind=json_list仅从惰性application/json读取置顶1+列表9，映射/日期basis与已验配置相同。候选已进入现有数组但enabled=false/persistence=disallowed，不是活动seed/生产允许项。正式候选用同一635664原字节→collector/SQLite→重复0新0修订→只读重开10字段0差异，源releaseDate秒精度/无时区/UTC null不变。该ONE配置轮DNS/HTTP0，ONE最新实际目标200仍02:56 UTC，不宣称连续可用。
- 前轮三源RSS证据183385403520d6bf52b028909e0d42ae6b0a59a0已获父会话限定认可：26条，R2-5=16/34、R2-4=21/39。旧完整原XML缺失后新授权抓取，不拼派生；原件/库保留。[报告](../evidence/r2-three-rss-2026-10-15/report.md)。
- 最新两媒体RSS批次：[报告](../evidence/r2-two-media-2026-10-15/report.md)。执行起点1833854、产品bebe144未改，XX-M01/XX-M03各DNS1+GET1，20417/18929原字节只私有ignored。各10条/pubDate秒精度明确+0000、无独立updated；重复0新0修订、readonly/query_only重开全字段0差异，离线TCP/fetch0。R2-5=18/34、21/39不变、其他39源未改。来源预算2次已用尽，待父审查；无源码变更，不新跑产品全门禁，GUI/S7仍pending。下一轮转向[18个非OK来源的存档/决策边界](../evidence/r2-two-media-2026-10-15/availability-frontier.md)，不重复已结论失败检索；MY-W01仅适合先做既有JSON字段/身份提案，无可直接升OK来源。
- 用户亲自应用后的扩展/生成配置23项、原21项已核对；本轮没有网络设置写入，旧198.18阻断/21项缺域只属历史，不再要求加这两个域名。初次离线脚本因正常lastSeenAt推进而断言失败，原日志/库保留；仅修断言后最终通过，未重抓或改产品。
- 继续保留 Northport重复关联冲突、VN-P01缺日期、MY-L01有10张静态标题时间卡片但缺详情href、CN-P02 302/ID-T02 307未跟随且旧证据无Location、NMC适用性FAIL、Westports最新2025-08-01 STALE。XX-W02仅forecast/specifications未验证、VNSGN原点海况缺测，约61.8km参考点不能冒充泊位。此轮不重查旧缺口；R1.5历史1/10为用户延后，不重找事件。
- 审查必须绑定完整代码SHA和原始stdout/stderr/raw exit；区分PASS/FAIL/BLOCKED/NOT_RUN、合成/真实保存原页/当次实网。原字节许可未知只放本地ignored，远端仅必要派生/hash；不能以HTTP200或用量未变代替字段或无外呼证明。
- 主会话保留Slack发令权。现用workspace `T0C82CF9WNR`、channel `C0C8BC001NY`、thread `1791602463.207089`，Cursor `<@U0C81EJCFV1>`。发下一轮前先确认唯一执行者、当前轮次和上一轮完成/审查，再一次性给完整指令；执行中不追加多条。新会话不假设自动接收Slack通知，也不自行发令。
- 无时间戳的历史“算了，停下来吧”已多次核实为历史误读，本轮没有新停止指令，不能继续将它当新停止。若以后确实新收到用户停止，则立即遵从；无法定位时报告原文和是否有时间/ID，不编造。
- 本轮授权为XX-M01/XX-M03两RSS有界原字节取证、隔离回放、现有R2-4缺口只读盘点、文档与正常推送PR8；没有生产源码修改。当前来源预算2次已用尽，下一实现/采集由主会话另定；Cursor已停用，不并行实现。
- 不合并、部署、强推、改写历史、配置真实密钥、扩大许可或端口范围、付费/LLM/24h或切生产。不启动根目录dev/start（会写保留DB），不按年龄/PID删除所有权锁。保留现有原始材料、预览、临时库和辅助文件，不清场。`gh`始终带 `-R rallsix66/Shipping-HOT`；分支CI静默，不能写成CI通过。
