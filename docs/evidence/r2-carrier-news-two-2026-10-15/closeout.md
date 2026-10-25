# 两源证据文档 Neat Freak — 2026-10-15

实际使用本机 `neat-freak` v3.0.0 Skill，并读取其 verification 参考。范围为本项目本轮证据文档与交接；未扩大到整个工作区、历史第三方材料安全审计或生产验收。

| 事实面 | 状态 | 依据与行动 |
| --- | --- | --- |
| 代码 | verified-current | 产品代码仍为 355952c0e8c01266adbe692dfcfd3bca9b3c17b2；执行 HEAD a5da09871d1a017ae947a0f3f56980461807bfaf 与该代码仅文档差异。本轮产品文件差异必须为 0；功能门禁 NOT_RUN。 |
| 运行态 | pending | 两次真实系统 DNS 特殊地址导致 HTTP0；没有原页、字段、运行内核、生产或24h验证。只读磁盘配置显示两精确主机缺失。 |
| 文档 | changed-and-verified | 修正 manifest 绑定并保留原件/执行过程；仅更新矩阵两项为 BLOCKED/NOT_RUN，其他39项逐源内容不变；status、报告、交接指向唯一矩阵。哈希、结构和本地链接结果见当前矩阵 validation。 |
| 规则 | verified-current | 读取当前 AGENTS.md、上级规则候选和本轮受影响路径；未发现额外下级规则，`.agents/skills` 没有相关 SKILL.md。现有计划、ADR、目录、分母、架构、来源许可和默认状态保持；未新增规则层重复计划。 |
| 记忆 | out-of-scope | 不读取或修改用户个人记忆；只在用户指定的仓库交接中澄清历史停止误读，不复制无关聊天或金融信息。 |
| 工作区 | verified-current | 实际盘点 raw exit0；只保留目录/规则/Git 摘要，完整盘点仍本地。原预览、克隆、DB、原字节、日志、辅助文件、所有权锁全部保留，不清场。 |

[盘点摘要](inventory.txt) / [原始盘点哈希](inventory-metadata.json) 仅证明做过目录枚举，不是安全审计。仅本轮新增/更新材料执行值模式扫描并保留合成正对照，不声称历史全仓已脱敏。

当前 R2-4 20/39、R2-5 12/34、有限数值3/5，整体R2仍未通过。Northport冲突、VN-P01无日期、MY-L01缺详情href、两个未跟随跳转、NMC适用性FAIL、Westports STALE及数值产品/原点缺口均保留。GUI/S7、24h、实际收费与源许可/字段未验证项保持 pending 或 NOT_RUN。

未改数据库/schema/源码/依赖/架构/工作流或 Clash 配置；无新增来源 DNS/HTTP、付费、LLM、merge、deploy、force-push。本轮仅正常提交推送草稿 PR8，发布状态须由本地/远端/PR HEAD 最终对照确认，不能由干净工作区推导上线。`.config/git/ignore` 在沙箱中读取存在 Permission denied warning，已如实保留，不是测试失败。

文档检查见 [当前矩阵验证](../r2-current-source-matrix-2026-10-14/validation.json) 和 [命令原始结果](../r2-current-source-matrix-2026-10-14/commands.json)。初次链接检查在归档清单生成前发现 `archive-hashes.json` 尚未生成，失败原件保存在 [initial-doc-validation.json](initial-doc-validation.json)，生成后重验；不隐去初始失败。ESLint 对 JSON 的 ignored warnings 不代表 JSON 已通过 lint，JSON 另做结构/证据校验；Git LF→CRLF 提示保留，文本引用哈希统一按提交 LF 核对，原始字节哈希不做换行转换。复核现场仍保留；本轮不请求也不执行清场。
