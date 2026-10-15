# R2 后续执行交接 — 2026-10-15

接手先读取 [AGENTS.md](../../AGENTS.md)、[status](../status.md)、[现役计划](../plans/shipping-hot-risk-intelligence-2026-09-29.md)、[信源目录](../intel-source-catalog.md) 与 ADR-007/008/009。本文是短索引；逐源事实只以[当前41项矩阵](../evidence/r2-current-source-matrix-2026-10-14/mapping.json)及其[报告](../evidence/r2-current-source-matrix-2026-10-14/report.md)为准。

- 仓库 `D:\try one\Shipping HOT`，远端 `rallsix66/Shipping-HOT`。分支 `codex/shipping-hot-r2`，草稿 [PR8](https://github.com/rallsix66/Shipping-HOT/pull/8)，base `codex/shipping-hot-r1-5`；PR7未合并。这是已批准的临时堆叠，不切回main、不重建实现。
- 本轮采集及文档修改前 HEAD：`a5da09871d1a017ae947a0f3f56980461807bfaf`；最近已审查产品代码：`355952c0e8c01266adbe692dfcfd3bca9b3c17b2`（P2严格日期回退修复已关闭）。包含本交接文件的文档提交才是本轮后续 HEAD：接手运行 `git rev-parse HEAD`、`git log -1 --format=%H -- docs/handoffs/r2-next-execution-2026-10-15.md`，并核对 PR8 head；不要把采集起点或文档提交当成代码测试提交。
- 批准方案沿用 Vite/React/Nitro/db0/SQLite 单体、单 Runtime/parser/预算体系；优先未来自动采集。41项保留，公开39、资讯34、数值5，阈值至少32公开OK与34字段回放，不能删分母或自改标准。
- 当前覆盖20/39、12/34，数值有限历史诊断3/5单列；整体R2/24h未通过。10个HTML候选默认关闭；TMD/BMKG内置seed enabled=true与Intel生产job默认off分开，未授权开启、写持久化配置或运行24h。
- 最新两源 [Maersk/ONE证据](../evidence/r2-carrier-news-two-2026-10-15/report.md)：精确 `https://www.maersk.com/news` / `https://www.one-line.com/en/news`。2026-10-15 02:03:12 UTC各系统DNS一次，`www.maersk.com`→`198.18.0.217`、`www.one-line.com`→`198.18.0.218`，安全阻断、HTTP0、解析NOT_RUN。当前选中Clash扩展/生成filter21项均无这两个精确主机；只读核验，未改设置。旧manifest错误代码标签已带原件更正。
- 最小下一步由主会话协调用户补齐并应用这两个精确主机例外，保留原21项；只读核对后另行安排新的有界两源核验。本交接不授权重试、网络配置修改、跟随跳转、详情/分页/隐藏接口或换站。
- 继续保留 Northport重复关联冲突、VN-P01缺日期、MY-L01有10张静态标题时间卡片但缺详情href、CN-P02 302/ID-T02 307未跟随且旧证据无Location、NMC适用性FAIL、Westports最新2025-08-01 STALE。XX-W02仅forecast/specifications未验证、VNSGN原点海况缺测，约61.8km参考点不能冒充泊位。此轮不重查旧缺口；R1.5历史1/10为用户延后，不重找事件。
- 审查必须绑定完整代码SHA和原始stdout/stderr/raw exit；区分PASS/FAIL/BLOCKED/NOT_RUN、合成/真实保存原页/当次实网。原字节许可未知只放本地ignored，远端仅必要派生/hash；不能以HTTP200或用量未变代替字段或无外呼证明。
- 主会话保留Slack发令权。现用workspace `T0C82CF9WNR`、channel `C0C8BC001NY`、thread `1791602463.207089`，Cursor `<@U0C81EJCFV1>`。发下一轮前先确认唯一执行者、当前轮次和上一轮完成/审查，再一次性给完整指令；执行中不追加多条。新会话不假设自动接收Slack通知，也不自行发令。
- 无时间戳的历史“算了，停下来吧”已多次核实为历史误读，本轮没有新停止指令，不能继续将它当新停止。若以后确实新收到用户停止，则立即遵从；无法定位时报告原文和是否有时间/ID，不编造。
- 当前授权仅收尾已有证据、文档核验、交接与正常提交推送PR8；本轮不改产品代码或跑功能门禁。下一实现轮需主会话明确任务，保持用户/Cursor未提交改动，不同时启动另一套实现。
- 不合并、部署、强推、改写历史、配置真实密钥、扩大许可或端口范围、付费/LLM/24h或切生产。不启动根目录dev/start（会写保留DB），不按年龄/PID删除所有权锁。保留现有原始材料、预览、临时库和辅助文件，不清场。`gh`始终带 `-R rallsix66/Shipping-HOT`；分支CI静默，不能写成CI通过。
