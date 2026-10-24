# ID-T02有限原页检查、更正与关闭候选验收

代码SHA：`8d0993e4164dae0b7a7f96dc531b9aac92be54b1`；前证据基线：`0274014037fbf68d7821309d2fd4090eaa036396`。本轮只复用已保存的原目录307/5字节与真实Location目标200/212037字节，**信源DNS0 / GET0 / 详情0 / 脚本执行0**。ID-T02找到可归属原日期，按明确授权实施最小关闭候选，**CN-P02条件分支未开启，请求0**。

## 前轮漏检更正与定位

前轮[结构观察](../r2-id-t02-location-2026-10-15/structure-observation.json)中“16卡片无明确日期”结论有误，原证据保留。检查只数time/datetime/date-class并枚举无子元素叶节点，漏掉了含SVG图标及直接日期文本的`span.card-tag`。本次每个原`/dok/`身份均找到该节点，例如 **`08 Okt 2026`**；不把“卡片未发现”扩成“全页没有日期”。

| 原隐藏片段 | 静态归属 | 绑定证据 |
| --- | --- | --- |
| S:1 | Terkini（最新），主布局 | 原文本调用`$RC("B:1","S:1")` → 模板B:1 → 同一按钮栏首个Terkini与第一内容兄弟 |
| S:2 | Populer（热门），主布局 | B:2映射、同一按钮栏第二个Populer与第二内容兄弟（d-none） |
| S:4 | Terkini（最新），d-md-none布局 | B:4映射、相同静态顺序与标签 |
| S:5 | Populer（热门），d-md-none布局 | B:5映射、相同静态顺序与标签 |

以上只读取调用文本、template位置、按钮标签与静态类，没有执行React/网页脚本或证明浏览器挂载。四组各4节点，共16节点；按身份归7项，重复的**身份/法规标识/描述标题/原日期全部一致**。

最小样例：身份`/dok/pmk-74-tahun-2026`；法规标识`PMK 74 TAHUN 2026`来自自身`span.title`；描述标题来自自身`p`，前缀“Tata Cara Pelaksan…”、完整89字符的hash见证据；原日期来自自身`span.card-tag`，`08 Okt 2026`→公历日`2026-10-08`。每组/模板/标签/卡片/日期节点均记录原字节区间及hash，完整字段仅本地ignored。[定位及7项最小样例](id-t02-finite-result.json)。

还将已有页面中一个精确`self.__next_f.push(JSON)`的**参数当JSON数据读取**，对62条可安全JSON解析的记录做有限检查；其余模块/文本等记录不执行或解释。16个原href props内都能交叉核对法规标识与日期。部分描述标题的组件表示无法直接当字符串比对，描述标题的权威依据是自身DOM `p`及重复节点一致性，没有编写RSC执行器或依赖它生产采集。

日期为`08 Okt 2026`（三项）、`02 Okt 2026`、`20 Mei 2025`、`31 Jul 2026`、`16 Agu 2007`。它们是**未标明时间角色的来源卡片日期**，不认证为发布日期、颁布日、生效日或港口影响时刻；不因Terkini/Populer栏目推断日期角色或新鲜度。day/raw/localDate保留，timezone=missing、offset/发布时间瞬间=null，2007/2025历史项不改成近期数据。

有限检查的两次附加“全部描述标题也应直接存在于JSON叶字符串/简单p表示”的预检断言失败已保留：[首次](finite-command-first-error.json) / [第二次](finite-command-second-error.json)。最终明确DOM为标题依据，JSON只交叉核对它能安全解读的原href/标识/日期；不声称全部描述标题已由JSON独立认证。最终[有限检查命令](finite-command.json)退出0，未发生新网络请求。

## 最小现有适配器实现

五个代码/测试文件：既有`parseLooseDate`增加显式`indonesian_month_abbr`整串DD/月缩写/YYYY语法，固定月份映射和既有公历合法性校验，不调用locale/Date.parse；禁止Buddhist或配置offset，纯day不造UTC。默认日期规则不变。

第13个声明候选`intel:id-t02`仍使用目录根`https://jdih.kemenkeu.go.id/`，`enabled=false / persistence=disallowed`，没有修改目录、active seeds或生产允许列表。候选读取现有body中四组自身卡片，排除导航；只允许同主机HTTPS `/dok`路径。item title取描述`p`，法规标识另在原件审计，与URL身份保留对应，不新增DB列或拼造标题。原日期取`span.card-tag`。复用既有同URL/title/date冲突拒绝及一致重复去重，不执行流式脚本，也不抓详情/页面列出的feed。总13候选为12 web_list + ONE json_list，生产仍仅TMD/BMKG可选且默认job off。

新增31项合成测试覆盖自有字段/重复冲突/导航与越界URL/日期严格性/未知时区/关闭许可、原307→目标200的离线collector链、重复0及无网络/正文；未重写parser/collector、安全入口或引入框架/迁移/Provider/SDK。

## 干净SHA门禁与真实保存原件回放

全新克隆`.tmp/id-mof-card-build-20261015`在代码SHA下，初始无node_modules，Node24.15.0/ABI137，正常frozen install/scripts；Provider凭据和Intel开启环境剔除。9命令全rawexit0：install/build/typecheck/lint、**19文件315定向通过**、**131文件1300全量通过/3既有跳过**、P0/P2C/Feed三项smoke。源码diff空，根保留DB/secret-file摘要不变。[完整门禁](../gate-8d0993e-id-mof-card/summary.json)。

正式候选在该干净克隆使用保存的完整307响应、真实Location及完整目标200原字节，通过既有secure fetch/collector，不截取或重建HTML。原目标SHA-256为`be6dd13c7c42b55e6c5526fd88dd00c2c8fcc4f7a1526929c713725776bd8d2b`，实际采集仍2026-10-15T07:37:48.920Z、起点4ca3a77，不是新代码实网。

- 原16节点逐字段绑定并验证重复一致，得到 **7 seen /7 new /0 revised**；隔离SQLite **7 items /7 versions /7 metadata-only title blocks**。
- 重复 **7 seen /0 new /0 revised**；ID/标题/日期/版本和内容hash不变，仅正常lastSeenAt推进。
- 原日期raw、公历day与原身份/完整描述标题一致，未知时间角色/时区保持，无发布时间瞬间，provider_usage不变。
- readonly+query_only重开 **7条 /0字段差异**，业务快照及DB字节hash不变。
- 系统DNS/TCP/global fetch/详情/正文实际调用全部0；注入lookup/transport各4次，只复读两条原307→200链。

[真实原件回放](replay-result.json) / [7项字段审计](field-audit.json) / [原命令输出](replay-command.json)。完整原始标题/URL/字节及隔离库只在本地ignored；远端仅最小样例、结构、日期与hash，无全文/摘要或DB。

## 状态与终点

ID-T02本地字段回放通过，**代码和资格建议交主会话审查**；批准资格暂保持PARTIAL/NOT_RUN，累计 **24/39、22/34**、历史数值 **3/5** 不增加，其他40源条目不改。SITC前轮限定过程认可不改，也不声称主会话独立重放本次私有原页。已完成[真实Neat Freak](closeout.md)及现役矩阵/status/交接更正；旧漏检、失败、原件、库、克隆全部保留。没有UI/路由改动，GUI/S7本轮NOT_RUN，既有GUI待验不变；无生产/24h/网络配置/付费/LLM/合并部署。本项止于本次有界实现与交审，不开启CN-P02或继续抓取。
