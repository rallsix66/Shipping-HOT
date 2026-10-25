# NMC两目录来源收口 — 2026-10-15

执行起点`f58e01e7360f17ab55706e36ce09851e265ddedb`，产品仍`bebe1441465adfcabb9daf93cb2a8656ec1fc796`，无产品实现/迁移/目录/阈值/生产改动。本轮**上游请求0、DNS0、TCP/fetch尝试0**。

按用户依9.29原R2-4/5的审定，CN-W01/CN-W02复用既有专用六页实网200/六条入库及既有16测试，均为**历史实测OK / 字段PASS**。当前**24/39（至少32，差8）、21/34（差13）**，数值3/5不变，其他39个来源条目不变。样本是**2026-10-11T01:38:50.372Z**，不是今天可用或24h。解除通知有真实产品/标题/URL/原时间字段，不要求必须活动预警；生命周期/有效性unknown、原时间未知TZ、无港口/事件推断仍保持。

## 更正10/13失败探针的性质

[原过程](../r2-p1-acceptance-mapping-2026-10-13/nmc-offline.test.ts.txt)在2026-10-13T03:55:13.246Z读取**10/11存档fixture**，注入lookup与HTTP200字节transport，刻意配置通用web_list为`#text / a[href] / div.author`；全局fetch禁止、networkCalls=0。它对不含文章锚点的固定产品页得到`web_list_invalid_link`（collector外层parse_failed、itemsCommitted0），并把这种预期失败断言为通过。[失败原日志](../r2-p1-acceptance-mapping-2026-10-13/nmc-offline.log)保持原样。

因此它证明的是**该通用适配路径不适用**，不是10/13又做了一次实网抓取，也不是后来源不可达或专用provider失效。旧报告“后来的实际失败/后失败阻挡资格”判断已纠正，原错误文本及归档在固定f58e01e版本保留。此负例留作适配约束证据，不继续作为两项源资格FAIL；没有重跑它或重写结果。

## 两目录ID与六个既有产品的映射

两项目录精确产品各一行；配套页均来自早已批准的`NMC_PAGES`，不是新来源/扩抓。原[实跑六页记录](../nmc-integration-2026-10-11/nmc-live-evidence.json)与[专用实现](../../../server/providers/nmc-warning.ts)一致。必要最小核验只调用既有`parseNmcPage/buildNmcFeedItem`读取六份原存档，比对Feed ID/title/source URL与原期号/时间/历史提示/解除句，六条全部一致，没有新parser或新的身份合同。

| 目录ID / 角色 | 既有产品 | 固定产品URL | 原标题 | 原时间 / 年度期号 |
| --- | --- | --- | --- | --- |
| CN-W01 / 目录精确产品 | 台风快讯 | https://www.nmc.cn/publish/typhoon/typhoon_new.html | 台风快讯 | 10月11日08时27分 / 2026年总1873期 |
| CN-W01 / 既有配套产品 | 台风公报 | https://www.nmc.cn/publish/typhoon/warning.html | 台风公报 | 2026 年 10 月 11 日 10 时 |
| CN-W02 / 目录精确产品 | 气象灾害预警（首页栏目） | https://www.nmc.cn/publish/country/warning/index.html | 大风预警 | 2026 年 10 月 05 日 06 时 |
| CN-W02 / 既有配套产品 | 台风预警 | https://www.nmc.cn/publish/country/warning/typhoon.html | 台风预警 | 2026 年 09 月 06 日 10 时 |
| CN-W02 / 既有配套产品 | 暴雨预警 | https://www.nmc.cn/publish/country/warning/downpour.html | 暴雨预警 | 2026 年 09 月 10 日 06 时 |
| CN-W02 / 既有配套产品 | 强对流天气预警 | https://www.nmc.cn/publish/country/warning/strong_convection.html | 强对流天气预警 | 2026 年 09 月 29 日 18 时 |

台风快讯身份沿用栏目+完整年度期号；其余栏目+归一化原发布时间串，均不附加时区。Feed显示时间是首次接收且received_at，原时间另存。六条中4条有历史产品提示、4条有明确解除主句；只表示该条为解除通知，不推断撤销其他对象/记录。原等级未映射、0关联港口、eventEligibility=false。六页并非六个目录分子，只增加CN-W01/CN-W02两项。[完整最小字段映射](product-mapping.json) / [命令与原输出](mapping-command.json)。

既有NMC16项专用parser/provider/Runtime/SQLite测试直接复用[前轮101测试命令中的16项](../r2-weather-reuse-2026-10-15/offline-command.json)，**本轮没有重复测试**。本轮必要映射rawexit0不冒充新实网、重跑存储链或完整门禁。旧实跑/API/浏览器证据按其原范围保留：样本6条、历史提示/解除字段、未知TZ/生命周期、无港口影响；旧GET计数不变不是全网络审计。

## 同轮边界

VN-W01/TH-W01/ID-W01及三项数值只整理[已认可引用索引](accepted-reference-index.json)，没有新资格/重复测试；NCHMF8成功4失败及修复证据、VNSGN原点缺测和独立参考边界保留。真正缺口仅给出[带来源的精确下一步](next-gaps.md)：PAGASA活动正样本、ID-W02官方港口KODE/数值映射、XX-W02 specifications实录，不猜URL、不请求、不新增产品范围。

本轮完整产品install/typecheck/lint/full test/build、GUI/S7/24h均NOT_RUN；文档/引用/归档验证、Markdown lint及真实Neat Freak单列。整体R2仍未通过，无网络设置/生产/付费/merge/deploy/force-push；所有存档、负例和现场保留。
