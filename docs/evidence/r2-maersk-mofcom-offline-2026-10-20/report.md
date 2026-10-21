# Maersk/CN-T01最小离线适配（2026-10-20）

本地D:\try one\Shipping HOT，codex/shipping-hot-r2@40629587e22d8932df105962ec214530e4054414；新隔离副本为.tmp/two-source-clean-20261020。授权仅离线实现与验证；本轮无站点GET、PPA重试、CA/TLS/Clash/服务改动、生产DB/Secret操作或Git发布。

| 来源 | 完整真实原件 | 独立节点→现有parser→真实collector→SQLite | 重复/重开 | 限制 |
| --- | --- | --- | --- | --- |
| XX-K01 | 46251B；18项=12新闻+3Advisories+3Rate announcements | 18/18标题、URL、rawDate、localDate与既有独立节点0差异；metadata_only，18版本/18title blocks | 第二次新增0/修订0；关闭重开18项/版本逐项一致 | 显示日2026-09-28至10-20；role未知、无timezone/instant；无档案或持续覆盖结论 |
| CN-T01 | 20318B；最新政策8项 | 8原始标题/URL/自身span日齐全；7相对HTTPS身份入库，与独立节点0差异，7版本/7title blocks | 第二次新增0/修订0；关闭重开7项/版本逐项一致 | 原HTTP政策一项及其解释链接被现有规则排除，不补造HTTPS；日期10-09至10-19，最新距抓取日1个公历日，不宣称UTC新鲜度 |

CN-T01文档title为“政策发布”，列表标题“最新政策”；只映射section.channel-con内policy-list的primary a[title][href]与同li的span，不映射“解读/图解”或解释链接。原catalog HTTP host/path与已经单次真实取证的HTTPS相同；[访问账本](../r2-three-url-after-save-2026-10-20/request-ledger.json)与[全部8项独立字段](independent-fields.json)保留原身份。日期节点没有钟点、时区或独立publication角色证明，不能把公告文号、URL年份、页脚或fetchedAt当发布时间。只对7条现有安全策略可保存身份回放，因此R2-5建议PARTIAL，绝不报8/8。

实现仅七文件：新增显式english_month_abbr_day（全字符串d Mon YYYY，严格公历、Gregorian-only且拒配置offset，保留raw/unknown role/day/localDate，null instant）；两个disabled/disallowed候选追加在旧候选之后，未加入intelSourceSeeds或生产选源名单；IntelSourceSeed与现有collect只转交已审secureFetch固定header opt-in，仍被既有source/URL/32768检查约束。未修改secureFetch、CA、DNS/pinning/TLS/timeout/body/redirect策略、schema/版本库或调度器；没有第二套材料库。CN同产品HTTPS目录测试仅对CN-T01固定值显式核对，原HTTP目录行未改。

定向226通过（含新增50）、完整1777通过＋3既有Windows跳过/146文件、完整原件独立回放2通过；正常frozen offline安装含scripts、build/typecheck/lint/full Vitest最终raw exit全0。回放只用固定样本transport与合成公网DNS元数据；http/https请求与系统DNS设置拒绝mock并断言调用0，Provider usage0。测试中的enabled:true仅位于隔离SQLite job参数，不写生产配置。先前安装/类型/格式失败日志全部保留，[完整命令及hash](gate-evidence.json)。既有header测试有1条JSDoc排版warning，未改已审文件。

[完整本轮增量](product.diff) / [适配与配置](adapters.diff) / [新增测试](tests.diff) / [七文件SHA](product-files.json) / [Maersk完整回放](replay-XX-K01.json) / [CN-T01完整回放](replay-CN-T01.json) / [资格建议](proposed-mapping.json) / [收尾](closeout.md)。完整增量已在执行会话实际消息分三段交付；增量相对本轮开始的既有脏工作区，不包含覆盖旧修改。真实HTML/SQLite/日志仅ignored.tmp；Git证据仅metadata、测试与diff，无完整站点body/header/cookie/token。

当前matrix计数保持26/39、24/34；仅建议XX-K01有限OK/PASS、CN-T01有限OK/PARTIAL，父审前不应用。若父接受这份保守建议才可能变28/39、25/34；不是当前状态，更不是R2通过。numeric两类证据保持；生产选源仍只有TMD/BMKG。GUI/S7/24h未验收、R3暂停，未提交/推送/部署或清理。PPA之前TLS失败保持，本轮未接触；此前受拒进程读取也未重试。
