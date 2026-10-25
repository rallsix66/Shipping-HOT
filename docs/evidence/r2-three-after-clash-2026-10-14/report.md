# 三个已批准精确例外应用后的索引/适配回放 — 2026-10-14

当前选中扩展hash匹配授权三行追加，生成filter恰好原14+新3=17，原14保留。09:06当前系统DNS各一次：saigonnewport.com.vn→210.211.104.122、idea.gov.vn→103.242.54.55、jdih.kemendag.go.id→103.42.205.161，均IPv4/public，未返回IPv6。没有本轮再次修改网络/缓存/CA/路由/TUN，未使用或输出控制器/订阅凭据。DNS元数据只保存必要公开地址/boolean/字段。前次benchmark假地址/未应用状态是历史，不能再称当前阻塞。

## 唯一索引抓取批次

09:08:39.423–09:08:53.001 UTC目录精确URL各GET1，共**HTTP3**。沿用secureFetchArticle全地址安全校验/HTTPS TLS验证；注入刚取得的当前系统DNS地址，由defaultTransport固定IP，未使用替代DNS或再次查DNS/跳转。并发1，512KiB/每源10s/总120s、retry/redirect/detail/API/pagination0，TH-C02不重抓。request reservation及每响应bytes/hash在解码前即时落盘，失败/result独立保存。每源200不单独计PASS。

| 源/URL | HTTP/bytes | 原始抓取SHA256 |
| --- | --- | --- |
| VN-P03 https://saigonnewport.com.vn/tin-tuc | 200 / 143215 | e730d4af7dacc5b95995139b6407f91a2adb2d4be7f1e2bbec7dbadc738b51c8 |
| VN-T01 https://idea.gov.vn/ | 200 / 22451 | 972674566750a436a01f84020a512400391dd47427a79464ed735f146f8c16ca |
| ID-T01 https://jdih.kemendag.go.id/ | 200 / 390183 | 7bda040e2c0db0ba557bc91837f1c05bc8a30e34d18e6a5568c9a37426b74032 |

全部UTF-8，HTTP与meta无冲突。原始页许可未知，完整HTML只本地ignored `.tmp/r2-three-after-clash-2026-10-14-private/`/隔离clone，不提交raw/body/scripts/header/cookie/input/key值；远端最多六条截短title/link/dateEvidence、过程/状态/error及独立archivehash。原始页面可能含第三方标识，未承诺private raw已全脱敏，不再分发；远端元数据不能重建完整原页，不能称远端完整raw fixture。本机可按hash复现。未删除原页/DB/旧预览或其他残留。

## 最小现有adapter变化

最终代码355bc861d4020ba22ddd00401de709d7cee497e3（初始af38350709d2fa4c9e9b98accbae8bc7ef678da1保留）。三个HTML候选enabled=false/persistence=disallowed→metadata_only，未加入活动registry/production allowlist；生产仍仅原TMD/BMKG允许。无新迁移/框架/调度器/Provider/预算。

- VN-P03：完整原页唯一 `.page-container > .news`，14个news-card，选h3.title标题link与p.news-label.date同卡片；14唯一URL/14日期节点，复用显式D/M/Y Gregorian day。排除image label/其他anchor作为title，保留资讯范围，不扩为港口停工/运营/海况证明。
- VN-T01：唯一newSlider三li，news012ndLink为detail业务query，news012ndLinkTit单独标题，不把日期拼进标题；news012ndLinkTime日日期，复用显式D/M/Y，无时区/时钟推断。3个唯一business query URL保留。
- ID-T01：完整原页唯一terkini/current regulations slider8卡片；选a.d-inline-block为链接、p.mt-2.mb-0为可见法规标题，**原文本身带省略号，保留原样，不从URL猜补全文**；badge字段Ditetapkan制定日，编号/年份anchor不当日期。排除populer tab和Lihat Regulasi按钮作为标题/条目，未知全文及规范内容覆盖不宣称。

显式indonesian_enactment_date只接受完整 `Ditetapkan D Month YYYY`、具体Indonesian月份及实际出现的literal October别名；严格公历合法性/闰年与既有year bounds，day precision、timezone missing、publishedAtnull。不是发布instant，不做宽松Date.parse/通用locale fallback，不接受Diundangkan/缩写/时间尾巴/非法日/佛历混用。重复URL不同title/date仍fail-closed。

## 首次失败与最终真实回放

初始af38350代码门禁通过，但原字节回放harness rawexit1：两VN分别14/3条成功，ID8条入库/重复/逐项字段相同，其中**7/8制定日有localDate，一行原文为Ditetapkan 14 October 2026，严格Indonesian规则留下unknown**。所有源结果先落盘、另一源未丢。初始结果目录 ../r2-post-clash-index-replay-2026-10-14 保留；其ID链一致性status不代表日期完整PASS，应以最终日期断言失败为准。没有掩盖该失败或挑选7条。

依据同一原字段加explicit October别名，保持完整语法/合法性/未知时区；最终355bc86新克隆重跑必要门禁和同一三raw（HTTP0/DNS0），最终回放harness rawexit0：

| 来源 | 首次items/versions | 重复 | 只读重开逐项title/URL/完整dateEvidence/metadata_scope |
| --- | --- | --- | --- |
| VN-P03 | 14/14 | new0/revised0 | 14条mismatches0；14day/missing timezone/nullinstants |
| VN-T01 | 3/3 | new0/revised0 | 3条mismatches0；3day/missing timezone/nullinstants |
| ID-T01 | 8/8 | new0/revised0 | 8条mismatches0；8day/missing timezone/nullinstants |

每源adapter/first/repeat/result先落盘再统一断言，真实collector/新文件SQLite/read-only reopen，只有transport返回完整保存字节，未打开上游socket。离线clock固定2026-10-14T09:15:00Z，区别于09:08实际抓取及未知源发布时间。真实完整raw回放与18项自写synthetic tests分开；合成覆盖选择正确标题/业务query/省略号保留、metadata重复、制定日非法/缺配置/角色前缀/闰世纪/缩写等及URL冲突。

## 门禁和余项

最终干净SHA frozen install/scripts/build/typecheck/lint rawexit0；14文件173定向、127文件1200通过/3既有Windows跳过；三个native/Runtime/Feed smoke均exit0。初始SHA同组通过也保留，不用初始门禁冒充修正代码。两克隆trackedserver/shared/src diff忽略行尾exit0，root保留DB/secret-file哈希前后相同，preview未改。既有duplicate-import/Browserslist/chunk/loader/CRLF警告真实保留。GUI/S7 NOT_RUN，本轮无UI/路由变化，既有视觉缺口不冒PASS。

新增三份原页的metadata离线回放有限通过；没有法规全文/政策人工审查/运营影响/生产24h结论。39公开源≥32/全源100%与整体R2仍待汇总独立验收；Northport真实冲突FAIL、VN-P01无日期等保留。不开生产/24h/LLM/付费/merge/deploy/forcepush。下一步按目录未完成项继续，不重复这些同等回放，不为覆盖率放宽冲突/许可/日期。

真实Neat Freak Closeout：installed inventory rawexit0（盘点、不安全审计），status/architecture与默认关闭、日期语义、省略号/第一次失败事实已同步。AGENTS/README/原计划不需命令或生产允许范围变更，memories本轮不写。三个新元数据目录阳性对照有效/值命中0、docs lint/diff无错误。六事实：codechanged-and-verified（最终离线SHA）；实际3GET/三raw回放verified、生产pending；docs changed-and-verified；rulesverified-current未改；memory只读/范围外；workspace原页/两个失败及修正clone/DB/旧预览保留，cleanup未授权。父独立复审pending、整体R2不标PASS。
