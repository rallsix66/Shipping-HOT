# P2 同锚点日期模式复审修复 — 2026-10-15

源码SHA **355952c0e8c01266adbe692dfcfd3bca9b3c17b2**。本轮仅修复title-dmy-date不匹配时误用通用日期解析的边界，不开启来源批次，不新增上游HTTP或系统DNS，不改网络、schema、许可或生产开关。

旧9ec4a2d在可见文本不满足“非空标题 (D/M/YYYY)”时仍把整段文本送给parseLooseDate；通用函数可以识别裸DMY、ISO日期、单独括号日期，导致该模式越过自己的语法。修复共享unknown证据构造，并在不匹配时直接返回unknown对象，不执行通用解析回退。保留原锚点文本（按既有raw合同仅去首尾空白），rule=title_dmy_date_mismatch、precision=unknown、localDate/publishedAt/utcOffset=null、timezone=missing。有效匹配仍使用原严格日历检查。

“真正非空标题”检查排除仅空白/零宽与控制字符前缀。新增5个负例：裸14/10/2026、2026-10-14、单独(14/10/2026)、空白前缀及零宽前缀；原有正常完整标题日期正例与7个非法/不支持日期负例继续保留。修前5例失败证据见[before-fix-regression.json](before-fix-regression.json)；失败保留，不称旧实现已通过这些边界。

没有证据表明原四条真实记录有误。本轮只用原私有183913字节响应重放：4 items/4versions、重复new0/revised0、只读重开全部title/URL/完整dateEvidence0差异，并与9ec4a2d已接受的四组完整字段逐项相同。[回放](../r2-anchor-date-review-replay-2026-10-15/summary.json)、[与旧四条比较](../r2-anchor-date-review-replay-2026-10-15/baseline-comparison.json)、[命令/SHA/stdout/stderr](../r2-anchor-date-review-replay-2026-10-15/command.json)。不撤回真实四条，不把字段有限通过扩成发布瞬间、灾害或港口影响。

| 原重定向来源 | 已有正文明确字面值 | Location | 可确认边界 |
| --- | --- | --- | --- |
| CN-P02 / 302 | HTML锚点href为`/btatw23_atbp/bt` | 未保存 | 只有相对路径线索，绝对目标及同域未证实 |
| ID-T02 / 307 | 完整5字节正文为`/home` | 未保存 | 只有相对路径线索，绝对目标及同域未证实 |

[只读检查记录](redirect-material-inspection.json)核对原字节摘要及已存本地响应metadata，没有找到Location字段。没有补造响应头、拼接同域URL或重新请求，停止重定向分支。MY-L01静态HTML明确有十张标题/时间卡片，只是详情锚点缺href而不满足链接契约；渲染机制和隐藏接口未验证，不称已证实的纯JS空壳。

干净新克隆，无旧node_modules，正常frozen install/scripts；build/typecheck/lint、15文件195定向、128文件1222全量通过/3既有Windows跳过、3个隔离smoke全raw exit0。测试源码diff0，根保留DB/secret-file摘要不变；计数/文件摘要不能单独证明无外呼。[完整门禁](../gate-355952c-anchor-date-repair/summary.json)。

覆盖与风险不变：R2-4 **20/39**（距32差12），R2-5 **12/34**，数值有限历史诊断 **3/5**；整体R2未通过。Westports STALE、Northport冲突、VN-P01无日期、NMC适用性、XX-W02 specifications、VNSGN原点与独立参考边界保留。所有10个HTML候选默认关闭，原TMD/BMKG生产允许范围未扩大，24h/付费/LLM/GUI/S7未运行。没有UI或路由变化，不机械重跑S7，原GUI验收仍pending。

私有原字节、隔离库/克隆和旧预览保留，未知许可正文不远端再分发；远端必要metadata/过程/hash不能重建完整原页。stdout/stderr原字符串和摘要在JSON内，展示日志仅去尾部空白。真实Neat Freak与限制见[closeout.md](closeout.md)，不merge/deploy/force-push或清场。

[只读源码/保存原页核对](../gate-355952c-anchor-date-repair/source-proof.json)确认7个源码/工具链文件与测试克隆一致、原字节摘要未变且仍被Git忽略；没有新增请求或额外功能测试。
