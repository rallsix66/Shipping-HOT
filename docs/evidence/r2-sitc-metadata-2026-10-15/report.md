# SITC限定metadata兼容修正与20条离线验收

代码提交 **`0a483dd18a2027c73bf950cc0b948c013e29cf09`**，前基线 `8be5bdda81ed5f88d43aec5f36d8d970cf479dbe`。本轮用户明确批准固定SITC HTTP metadata身份例外和完整源日期语法；没有引入新Provider/框架/迁移。本轮**信源GET/DNS0、详情/正文请求0**，未读取或修改Clash配置，未开启生产或24h。

## 最小实现

- 既有`WebListConfig`增加显式`metadataLinkRule: sitc_show`。仅`intel:xx-k03`、`persistence=disallowed`、policy允许的精确主机`www.sitc.com`、精确路径`/en/show.asp`、唯一数值`id`身份可用。保留原HTTP(S)协议与业务ID；拒绝其他主机/路径/协议、userinfo凭据、异常端口、多ID/额外query及prefix覆盖。原始URL与既有canonical URL都校验，避免尾斜杠被canonical化后越界。默认仍拒绝HTTP。
- 这是metadata身份保存权限，**不是HTTP抓取授权**。`secureFetchArticle`、抓取allowHttp/HTTPS降级/CA/DNS规则没有改动，sourcePolicy不传allowHttp；单测证明后续HTTP正文入口在DNS前拒绝、HTTPS→HTTP跳转仍拒绝。collector只复读HTTPS列表原件，不请求详情。
- 显式`dateFormat: sitc_publication_day`只识别整串`发布日期: YYYY.MM.DD`，复用既有公历日期校验，保留完整raw和basis；合法值day/localDate，timezone=missing、publishedAt/utcOffset=null。错误日期/附加文字/其他标签或格式保持unknown；无默认时区或宽松Date.parse。
- 正式声明第12个默认关闭候选（11 web_list + ONE inert json_list），SITC精确目录主站URL，`enabled=false / persistence=disallowed`，仅20卡片自身标题链接和日期。它没有进入active seeds/生产允许列表；原TMD/BMKG及默认job关闭保持。目录一行还列越南站，候选测试明确只核对批准的主站URL，未改目录或扩大请求。

## 干净SHA门禁

全新本地克隆`.tmp/sitc-metadata-build-20261015`，detached于上述代码SHA；启动前无node_modules，正常`pnpm install --frozen-lockfile`及scripts，没有ignore-scripts/旧模块/手工native复制。固定Node24.15.0 / ABI137，Provider/LLM/Intel启用环境剔除。全部9项rawexit0：[完整门禁](../gate-0a483dd-sitc-metadata/summary.json)。

| 门禁 | 结果 |
| --- | --- |
| install / build / typecheck / lint | 各rawexit0 |
| 定向回归 | 18文件 / 284通过，含39项SITC边界测试 |
| 全量Vitest | 130文件 / 1269通过、3既有跳过 |
| native P0 / P2C Runtime / Feed Freshness smoke | 3项rawexit0 |
| 测试源码diff | 空 |
| 根保留DB/secret-file摘要 | 前后完全一致 |

没有UI/路由/shell改动，GUI/S7本批NOT_RUN且旧GUI待验不变；这不是生产/24h/新实网验证。门禁原stdout/stderr、逐命令时间/退出码和过程均留存，不用分支静默CI代替本地门禁。

## 同一完整原件的正向20条回放

复用2026-10-15T06:32:48.737Z真实GET200、38839字节的私有完整HTML，原采集起点`e37c5e4`，不是在新代码SHA下重抓。SHA-256 **`2f590a0f00dbe6f6cacc98102775942c42d288995c69206c0d33b46b99afe7c4`**。旧[真实原页与不兼容负例](../r2-sitc-applied-2026-10-15/report.md)、原DNS阻断、首次错表名日志/库全保留。

验收程序从干净代码克隆运行，直接导入正式disabled candidate；独立读取原DOM的20个标题、原HTTP URL/业务ID、完整日期字符串，与parser/SQLite/readonly重开逐项对照。完整标题/URL只在`.tmp/r2-sitc-metadata-20261015-private/exact-field-audit.json`，远端仅hash/原日期，无正文/摘要。[字段审计](field-audit.json) / [正向结果](replay-result.json) / [命令原输出](replay-command.json)。

- 首次collector：20 seen / 20 new / 0 revised；SQLite **20 items / 20 versions / 20 title blocks**，content_scope全metadata_only，无正文/摘要。
- 重复：20 seen / **0 new / 0 revised**，ID/业务字段、版本和内容hash不变，仅正常lastSeenAt推进。
- 原HTTP协议/每个业务ID、完整raw`发布日期: ...`和公历localDate全部一致；day precision，时区/offset/发布时间瞬间保持missing/null。没有把接收时刻当发布时间，也没有补造截短标题。
- readonly+query_only重开：20条字段对照、**0差异**，整张业务表和DB字节hash一致；provider_usage无变化。正式候选在隔离库也enabled=false。
- 离线TCP/DNS/global fetch均0；两次注入lookup/transport只是复读原件，且都断言唯一HTTPS列表URL。详情/正文请求0，生产未启用。

首次验收launcher在启动测试前误以为门禁应有10项，实为完整9项，因而退出1；[记录](acceptance-launch-first-error.json)保留。仅把预检改为核对9个实际命令名，门禁/产品未改，测试尚未启动所以无重跑实网。此前根目录pnpm shim未找到vitest，已用同一已安装CLI直接Node做106项预检；最终权威门禁在新克隆正常pnpm命令全部通过。初始lint样式问题已在代码提交前修复，预检材料保留本地。

## 状态与审查边界

按本轮明确认可，SITC已批准可记PARTIAL，尚不计OK。新代码下20条字段回放本地通过，可提出**R2-4 OK / R2-5 PASS建议待父复审**，批准计数仍 **23/39、21/34、历史数值3/5**；R2-4分类现在23 OK / 9 PARTIAL / 1 STALE / 2 BLOCKED / 4 NOT_RUN。其他40来源条目不改，未把代码验收自动变为整体R2 PASS。

真实Neat Freak/当前矩阵/架构/规则/交接同步及文档验证另存；本轮没有需要新Provider/迁移/框架的改变。全部原件、负例、测试库与干净克隆保留，未清场。无网络设置/秘密/LLM/付费/合并/部署，父审pending；生产/24h和GUI/S7仍NOT_RUN。
