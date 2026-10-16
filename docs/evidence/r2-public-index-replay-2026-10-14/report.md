# R2 现有 HTML 适配器三源配置与完整原字节回放 — 2026-10-14

代码 `ca654122bcad240f090d0e675071a5e208237e8e`，沿用原 BackgroundRuntime / secureFetchArticle / fromHtml / SQLite，未增加调度器、parser框架、迁移、Provider或真实启用。**本轮source HTTP0/DNS0**；使用07:56上一独立批已存完整原字节，而非远端脱敏骨架。三个来源配置默认关闭、不加入活动seed registry，productionIntelOptions仍仅允许原TMD/BMKG，正文许可不扩大：persistence=disallowed → metadata_only。

## 实际变化

- CN-T02：精确目录https://szs.mof.gov.cn/zhengcefabu/，完整raw确认 `.zzright .listBox > ul.liBox`唯一，10个li内同项a标题/link及span YYYY-MM-DD，复用既有ymd，不改此日期算法。
- PH-C01：完整raw定位唯一 `.uk-child-width-1-1.uk-grid-match`、11个 `.el-item.uk-card`；只取 `h3.el-title > a[href]`，日期 `.el-meta`，排除Read more作为条目/title。其同目标不同标签未送入两条条目，不放宽重复冲突。
- 原parseLooseDate没有完整英文月份配置。最小新增 `english_month_name` opt-in，整串Month D, YYYY/full English month、Gregorian合法日校验，公历day精度；未知时区、publishedAt=null。禁止未配置回退Date.parse、缩写/序数/前后附加正文、非法月日、佛历混用；原Thai/数值日期及重复URL不同title/date fail-closed保持。
- CN-P01：本地完整raw找到真正“通知公告”首tab，精确tzgg header关联的首ul唯一，8个li各有xxgk/article标题/link及index-tab-date。加入同样默认关闭元数据配置，排除hsyw要闻，目录根URL未改，没有请求栏目的新URL。
- VN-P01：仅离线检查完整第一张通告表10行/20 cells及可见date属性，0完整日期、0datetime；表头及200/TBHH等编号不当日期。日期unknown、验收缺字段；未新增配置/展开详情。

## 真实原字节结果（与合成分开）

| 来源 | 完整本地抓取hash | 首次／重复／只读重开 |
| --- | --- | --- |
| CN-T02 | 934dfb210e414105867c99db2907ebcf98c175b643a3bc74157f2d9c1679df04 | 10items/10versions；重复新0修订0；逐条title/URL/完整dateEvidence/metadata_scope核对0差异；10个ymd localDate，时区未知、instant全部null。 |
| PH-C01 | 9d56a123e75dd0d3fa7523da3d410125a5c71f23e42dbacd012c50d31627a6c6 | 11items/11versions；重复新0修订0；只读重开11条完整字段0差异；11个configured_english_month_name localDate，day精度、时区未知、instant全部null。 |
| CN-P01 | 6dc9a6c69a50a0643510cc2fc0125f8bb686a150ff42f3abc1d5a88e25593a2a | 真正通知公告8items/8versions；重复新0修订0；只读重开全部完整字段0差异；8个ymd localDate，day精度、时区未知、instant全部null。 |

每源 adapter/first/repeat/result 先落盘，再统一断言，一个FAIL不会丢另一源结果。解析、collect及新文件SQLite/只读重开都是真实产品代码；注入transport只返该源完整raw，地址是明确离线测试地址，不构造实网调用。raw replayer一项测试rawexit0；源结果为这份原页 `OFFLINE_REPLAY_ONLY_PASS`，不是24h/全P1生产或覆盖结论。新候选未启用，原Northport真实冲突FAIL及Thai100条有限回放不改变。

合成fixture独立标注author synthetic，测试包含三个列表正确映射、PH Read more排除、不同链接各自条目、同URL不同title/date fail-closed并保留已有rows/versions、完全重复去重、年月日/闰世纪/无显式配置/佛历混用/缩写/附加文本等边界。没有提交未知许可原页到产品fixture冒充合法完整raw。

## 门禁与证据边界

干净代码SHA新克隆 frozen install（scripts启用）/build/typecheck/lint均rawexit0；12文件151定向、125文件1178通过/3既有Windows跳过；三个既有native/Runtime/Feed smoke均rawexit0。root保留DB及secret-file哈希前后相同，preview未改。clone trackedserver/shared/src diff忽略行尾exit0；后续文档提交不冒充代码测试SHA。GUI/S7 NOT_RUN，本轮无UI/路由变化；之前视觉/集成未验证仍保留。既有重复import/Browserslist/chunk/loader/CRLF警告不写成零警告。

许可与敏感边界：完整原页再分发许可未知，raw仅本地ignored取证目录/克隆副本，隔离DB也仅本地；远端仅六条以内截短title/link/dateEvidence及过程/计数/error，不提交HTML/scripts/header/cookie/input/key/正文值。取证hash与派生archive hash分开，远端不能凭元数据重建完整原页；本机可按hash复现，不称远端完整raw证据。元数据扫描阳性对照与实际命中分开，不当全项目安全审计；不清理原字节、DB、旧preview或其他残留。

39公开源≥32可用要求不变；本轮证明三个原页离线解析链有限通过，最终source availability计数及>=80%/R2-5全源100%仍待独立汇总/复审。没有全R2 PASS、无新上游HTTP、生产启用/24h/LLM/付费/merge/deploy/forcepush。

下一最小缺口：VN-P01日期unknown保留，是否需要有界详情核查须另行下令；其它P1目录未配置/原始材料与许可仍逐源完成，Northport冲突不为达标消除。不要重复已通过的同等回放或日期规则。

真实Neat Freak Closeout：installed inventory rawexit0（只盘点、不当安全审计）、状态/架构与代码边界已同步、README/AGENTS/原计划无需行为或命令变更（生产仍旧两源、无新启用/授权），memories本轮不写。新元数据敏感值模式阳性对照有效、实际命中0；docs lint/diff无错误。六事实：代码changed-and-verified（离线）；运行raw回放verified/生产pending；docs changed-and-verified；rulesverified-current未改；memory只读/范围外；workspace保留原页/DB/旧预览、cleanup未授权。独立父复审pending、整体R2未通过。
