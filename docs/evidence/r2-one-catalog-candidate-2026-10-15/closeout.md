# ONE目录/候选落地 Neat Freak — 2026-10-15

沿用本机真实 `neat-freak` v3.0.0及verification参考，按当前项目已生效规则执行。本轮实际盘点raw exit0，[摘录](inventory.txt)与[完整清单hash](inventory-metadata.json)保留，目录盘点不是安全审计。

| 事实面 | 状态 | 核对与处理 |
| --- | --- | --- |
| 代码 | changed-and-verified | bebe1441465adfcabb9daf93cb2a8656ec1fc796仅批准的一项目录URL/对应关闭候选及一致性测试；干净九命令全0，原HTML正式候选10字段回归通过。解析器、日期、URL安全和字节上限机制不变。 |
| 运行态 | pending | 本轮来源DNS/HTTP0，Socket/fetch守卫回归0尝试；仅复用已有原页，没有新的连通性/连续可用/生产或24h证明，原实网时间不刷新。 |
| 文档 | changed-and-verified | status、架构、目录映射、唯一矩阵与交接同步，旧提案/308/抓取SHA按历史保留；覆盖21/39、13/34、有限数值3/5完全不变。至多三项建议标PROPOSED_ONLY_NOT_EXECUTED，不扩大为执行授权。 |
| 规则 | verified-current | 当前AGENTS、计划、目录及ADR边界不变。11个页面候选都关闭，2个活动seed声明/默认job开关/生产来源选择范围未扩大；无新Provider/迁移/主机/许可/网络配置。 |
| 记忆 | out-of-scope | 不读取或修改个人记忆，不复制无关用户信息。交接保留历史停止误读澄清，真正新停止仍须遵从。 |
| 工作区 | verified-current | 原始HTML/JSON只私有ignored，库/clone/预览/日志/锁全部保留；没有清场、改根保留DB、系统配置或推送原文/凭据。 |

代码/目录提交与后续证据文档分开，源码门禁绑定准确完整SHA；每命令JSON保留原UTF-8 stdout/stderr及原字节hash，展示log只规范行尾。Git LF→CRLF、沙箱`.config/git/ignore`读取warning、既有自动导入warning保留。JSON被ESLint忽略不当作已lint，结构/链接/证据hash另由当前矩阵验证。

只扫描本轮待提交派生材料并保留合成正对照，不声称历史全仓脱敏。架构/路线/ADR没有新决策需求；旧“目录提案待审/仅离线typed候选”是前轮历史，现役说明改为已批准目录和已声明关闭候选。此前字段通过仅为有限实测/回放，不升级为持续可用或整体R2 PASS。

不重找历史停复工事件、不请求Maersk或重复已结束失败检索；本轮零新闻上游请求，依赖安装网络另列。PR8仅正常推送、保留草稿和原base，分支CI无运行不等于通过。现场继续保留，未请求或执行清场。
