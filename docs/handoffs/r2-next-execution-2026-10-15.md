# R2 后续执行交接 — 2026-10-15

接手先读取 [AGENTS.md](../../AGENTS.md)、[status](../status.md)、[现役计划](../plans/shipping-hot-risk-intelligence-2026-09-29.md)、[信源目录](../intel-source-catalog.md) 与 ADR-007/008/009。本文是短索引；逐源事实只以[当前41项矩阵](../evidence/r2-current-source-matrix-2026-10-14/mapping.json)及其[报告](../evidence/r2-current-source-matrix-2026-10-14/report.md)为准。

- 仓库 `D:\try one\Shipping HOT`，远端 `rallsix66/Shipping-HOT`。分支 `codex/shipping-hot-r2`，草稿 [PR8](https://github.com/rallsix66/Shipping-HOT/pull/8)，base `codex/shipping-hot-r1-5`；PR7未合并。这是已批准的临时堆叠，不切回main、不重建实现。
- 本轮源码/文档收尾起点 HEAD：`01934a5746c10d4165f4c4ffc5ce145d6de33d16`；真实ONE目标采集HEAD：`03d1515d33dd1c5d96137c43e0aafb596b334be3`；本轮已本地验证、待父审查产品代码：`01934a5746c10d4165f4c4ffc5ce145d6de33d16`（现有JSON mapper/collector受限HTML输入，244定向/1229全量+3跳过/3smoke；前P2已关闭）。包含本交接文件的文档提交才是本轮后续 HEAD：接手运行 `git rev-parse HEAD`、`git log -1 --format=%H -- docs/handoffs/r2-next-execution-2026-10-15.md`，并核对 PR8 head；不要把采集起点或文档提交当成代码测试提交。
- 批准方案沿用 Vite/React/Nitro/db0/SQLite 单体、单 Runtime/parser/预算体系；优先未来自动采集。41项保留，公开39、资讯34、数值5，阈值至少32公开OK与34字段回放，不能删分母或自改标准。
- 当前覆盖21/39、13/34，数值有限历史诊断3/5单列；整体R2/24h未通过。10个HTML候选默认关闭；TMD/BMKG内置seed enabled=true与Intel生产job默认off分开，未授权开启、写持久化配置或运行24h。
- 最新[ONE目标证据](../evidence/r2-one-newsroom-target-2026-10-15/report.md)：原目录/en/news实际308及Location/en/newsroom保留；单独核准目标02:56 UTC一次DNS（104.19.145.47/104.19.144.47）和GET200、635664字节UTF-8，无进一步跳转。对应Newsroom身份已核实。完整原HTML内嵌application/json置顶1+列表9，经现有collector/隔离SQLite/重复0新0修订/只读重开原字段0差异；源releaseDate秒精度、无时区、UTC null，不认证发布时间或影响。默认关闭metadata-only typed候选只在离线证据，未注册。源码新增唯一惰性script读取、至多4自有路径合并/500项/冲突失败；只有显式HTML模式1MiB，旧输入512KiB不变。
- 下一步先审[目录一行URL提案](../evidence/r2-one-newsroom-target-2026-10-15/catalogue-url-proposal.diff.txt)：/en/news→/en/newsroom，身份/格式/其余列不变，当前PROPOSED_NOT_APPLIED；本轮没有改永久目录、白名单或active注册。ONE以已保存308对应的已验证目标计来源OK/字段PASS，不写成原URL直接200。网络预算已用完，不自动请求。Maersk本轮0请求，旧通用fetch_failed底层原因未知；新错误记录/脱敏能力仅合成验证，不能冒称Maersk诊断。
- 用户亲自应用后的扩展/生成配置23项、原21项已核对；本轮没有网络设置写入，旧198.18阻断/21项缺域只属历史，不再要求加这两个域名。初次离线脚本因正常lastSeenAt推进而断言失败，原日志/库保留；仅修断言后最终通过，未重抓或改产品。
- 继续保留 Northport重复关联冲突、VN-P01缺日期、MY-L01有10张静态标题时间卡片但缺详情href、CN-P02 302/ID-T02 307未跟随且旧证据无Location、NMC适用性FAIL、Westports最新2025-08-01 STALE。XX-W02仅forecast/specifications未验证、VNSGN原点海况缺测，约61.8km参考点不能冒充泊位。此轮不重查旧缺口；R1.5历史1/10为用户延后，不重找事件。
- 审查必须绑定完整代码SHA和原始stdout/stderr/raw exit；区分PASS/FAIL/BLOCKED/NOT_RUN、合成/真实保存原页/当次实网。原字节许可未知只放本地ignored，远端仅必要派生/hash；不能以HTTP200或用量未变代替字段或无外呼证明。
- 主会话保留Slack发令权。现用workspace `T0C82CF9WNR`、channel `C0C8BC001NY`、thread `1791602463.207089`，Cursor `<@U0C81EJCFV1>`。发下一轮前先确认唯一执行者、当前轮次和上一轮完成/审查，再一次性给完整指令；执行中不追加多条。新会话不假设自动接收Slack通知，也不自行发令。
- 无时间戳的历史“算了，停下来吧”已多次核实为历史误读，本轮没有新停止指令，不能继续将它当新停止。若以后确实新收到用户停止，则立即遵从；无法定位时报告原文和是否有时间/ID，不编造。
- 本轮授权的ONE目标一次DNS/GET已完成，Maersk只能合成错误验证。当前阶段为代码/证据交审与正常推送PR8，不剩自动网络预算；新实现轮由主会话明确，保留用户/Cursor改动，不启动另一套实现。
- 不合并、部署、强推、改写历史、配置真实密钥、扩大许可或端口范围、付费/LLM/24h或切生产。不启动根目录dev/start（会写保留DB），不按年龄/PID删除所有权锁。保留现有原始材料、预览、临时库和辅助文件，不清场。`gh`始终带 `-R rallsix66/Shipping-HOT`；分支CI静默，不能写成CI通过。
