> CN-T01后续更新（2026-10-20）：父会话已补正式HTTPS同产品依据；本机一次系统DNS返回198.18.0.5，安全链阻断，HTTP0。原表该项“缺HTTPS依据”为当时缺口，现转为本机DNS BLOCKED/无原页，资格变更待父审；分子不变。见[后续本机证据](../r2-cn-t01-https-2026-10-20/report.md)。

> 历史本地证据说明（2026-10-21 补注）：本目录是 2026-10-20 的离线收口快照，正文保持原样。其中 25/39、24/34 是当时的数字，现行口径以 [mapping.json](../r2-current-source-matrix-2026-10-14/mapping.json) 的 28/39、25/34 为准，均未通过。MY-L01 日期格式代码已随 `3f8971e3` 推送；观察启动器与环境修复已随 `c9af8c55`、`160c67a9` 推送。文中 `.tmp/…`、私有原存档、隔离 DB、clone 与原始 stdout/stderr 路径都是历史本地证据，不随库交付，也没有补造。原文中的本机用户目录已替换为 `<USERPROFILE>`。

# R2剩余矩阵（2026-10-20，离线复核）

当前基线 `codex/shipping-hot-r2@40629587e22d8932df105962ec214530e4054414` 加保留的未提交候选。本表是累计归档资格的逐项交接，不是当前在线率。原矩阵/分母/判定逐字节不改；25/39，目标至少32；资讯24/34；历史数字诊断3/5独立。R2-6继承aea56e72限定PASS；历史天气回放1/10已停止扩展，不作为本轮R2阻塞。

## 14个可用性非OK来源

| ID | 可用性 / 资讯字段 | 精确缺口 | 可复用证据 | 最小动作及是否需用户/网络 |
| --- | --- | --- | --- | --- |
| CN-P02 | PARTIAL / NOT_RUN | 真实Location指回原HTTPS根；没有不同目标/栏目正文。 | 已有302头/hash可复用，不能由body猜路径。<br>[r2-cn-p02-location-2026-10-15/catalogue-capture.json](../../evidence/r2-cn-p02-location-2026-10-15/catalogue-capture.json) | 先取得可证的不同官方目标；再单次受控请求/标题链接日期回放。<br>需要官方目标证据及另批请求；不重试原自指URL。 |
| CN-T01 | NOT_RUN / NOT_RUN | 目录产品是HTTP，安全入口只准HTTPS，未请求。 | 无合规原页；目录说明不是字段证据。<br>无合规原页字段证据；仅目录 | 确认正式HTTPS产品依据；若只能HTTP，先作单独协议决策。<br>需要用户/官方URL证据及另批请求；不能自动改协议。 |
| VN-P01 | PARTIAL / PARTIAL | 10行标题/链接存在，原页无日期或日期属性。 | 完整字段检查/表格元数据可复用；文号/抓取时间不能充当发布日期。<br>[r2-four-after-clash-2026-10-14/summary.json](../../evidence/r2-four-after-clash-2026-10-14/summary.json) / [r2-four-after-clash-2026-10-14/VN-P01-table-metadata.json](../../evidence/r2-four-after-clash-2026-10-14/VN-P01-table-metadata.json) / [r2-public-index-replay-2026-10-14/cn-vn-full-raw-field-inspection.json](../../evidence/r2-public-index-replay-2026-10-14/cn-vn-full-raw-field-inspection.json) | 取得与同一材料身份绑定的原日期证据后再配置、完整回放。<br>需新的合法原日期样本；详情请求必须单独限定，现不请求。 |
| MY-P02 | STALE / PASS | 10原项中7项源title真空；3有效项最新2025-08-01，仍STALE。 | 完整XML逐项核算及3条collector/SQLite/repeat/reopen已通过，不重开字段门禁。<br>[r2-westports-rss-2026-10-15/MY-P02-capture.json](../../evidence/r2-westports-rss-2026-10-15/MY-P02-capture.json) / [r2-westports-rss-2026-10-15/MY-P02-replay.json](../../evidence/r2-westports-rss-2026-10-15/MY-P02-replay.json) | 未来在同一精确Feed取得近期有效标题项，沿原解析器复核。<br>需要另批一次新Feed响应；不能由raw最高日期改判。 |
| MY-P03 | PARTIAL / FAIL | 同一真实URL关联冲突标题/日期；collector失败且0入库。 | 完整私有原页与冲突审计可复用，不能任选首项/删冲突。<br>[r2-six-public-2026-10-14/summary.json](../../evidence/r2-six-public-2026-10-14/summary.json) / [r2-two-raw-dns-2026-10-14/replay-summary.json](../../evidence/r2-two-raw-dns-2026-10-14/replay-summary.json) / [r2-two-raw-dns-2026-10-14/storage-and-conflicts-audit.json](../../evidence/r2-two-raw-dns-2026-10-14/storage-and-conflicts-audit.json) | 需要原文明确且不同的稳定身份/关联证据，再作源专用适配。<br>现有归档不支持合法消冲突；需来源证据，网络访问另批。 |
| MY-L01 | PARTIAL / FAIL | 十张卡片缺文章href；此前英文缩写月/12小时制时间不支持。 | 原124208字节私有存档及十条事实时间可复用；本轮只修时间格式，保留无href失败。<br>[r2-four-reapplied-2026-10-15/summary.json](../../evidence/r2-four-reapplied-2026-10-15/summary.json) / [r2-reapplied-raw-replay-2026-10-15/MY-L01-suitability.json](../../evidence/r2-reapplied-raw-replay-2026-10-15/MY-L01-suitability.json) | 已补显式格式；后续还需真实文章链接证据，不能用目录自链接/标题造slug。<br>本轮修复无需网络；解除字段/可用性失败仍需身份依据，访问另批。 |
| ID-W02 | NOT_RUN / NOT_APPLICABLE_NUMERIC | doc/200仅16个目录/文件链接，非已识别apidoc；无港口KODE/数值产品。 | 已存doc目录诊断可复用；不把它当数值JSON。<br>[r2-bmkg-doc-jma-attribution-2026-10-15/ID-W02-doc-capture.json](../../evidence/r2-bmkg-doc-jma-attribution-2026-10-15/ID-W02-doc-capture.json) | 取得官方apidoc、Jakarta/Tanjung Priok KODE和精确产品映射再验证。<br>需官方资料/明确URL及另批请求；不猜KODE或抓全部目录。 |
| PH-P01 | NOT_RUN / NOT_RUN | 一条目录含两URL，均无合规完整产品/真实字段存档。 | 只有源级CA单元机制；不证明真实证书或握手已解决。<br>无合规原页字段证据；仅目录 | 分别确认两产品范围、TLS实况及必要的源级CA，再归档回放。<br>需要有界诊断/官方CA依据及另批请求；不改系统信任。 |
| PH-W01 | PARTIAL / NOT_RUN | 最新精确目录403；此前空壳/iframe不证明活动预警或明确空列表。 | 403原始响应摘要/旧结构观察可复用，不能当无天气事件。<br>[r2-official-gaps-applied-2026-10-15/PH-W01-capture.json](../../evidence/r2-official-gaps-applied-2026-10-15/PH-W01-capture.json) | 先取得合法官方正样本、实际材料身份和原时间字段，再定适配。<br>需官方样本或另批单次请求；不绕403、不猜iframe产品。 |
| PH-W02 | PARTIAL / NOT_RUN | 最新精确目录403；无官方正样本、selector/原时间合同。 | 403摘要可复用，不能与PH-W01混为两个成功产品。<br>[r2-official-gaps-applied-2026-10-15/PH-W02-capture.json](../../evidence/r2-official-gaps-applied-2026-10-15/PH-W02-capture.json) | 取得weather-advisory正样本和明确时间/身份规则再回放。<br>需官方样本或另批请求；不重复403凑证据。 |
| XX-W01 | BLOCKED / NOT_APPLICABLE_NUMERIC | 精确targetTc返回404；不是空台风列表。 | 与XX-W02共用同一次404；历史数值诊断有限通过独立保留。<br>[r2-official-gaps-applied-2026-10-15/XX-W02-targetTc-capture.json](../../evidence/r2-official-gaps-applied-2026-10-15/XX-W02-targetTc-capture.json) / [r1-5-1-live-2026-10-10-356e6fe/r1-5-1-evidence.json](../../evidence/r1-5-1-live-2026-10-10-356e6fe/r1-5-1-evidence.json) | 先取得官方当前精确产品依据；再做有界获取/数值验证。<br>需官方资料和另批请求；不猜替代URL或重放旧3/5当当前成功。 |
| XX-W02 | PARTIAL / NOT_APPLICABLE_NUMERIC | forecast有历史诊断，specifications产品未完整验证；前提targetTc同一次404。 | 历史forecast诊断及同一404可复用；无完整数值wire回放。<br>[r2-official-gaps-applied-2026-10-15/XX-W02-targetTc-capture.json](../../evidence/r2-official-gaps-applied-2026-10-15/XX-W02-targetTc-capture.json) / [r1-5-1-live-2026-10-10-356e6fe/r1-5-1-evidence.json](../../evidence/r1-5-1-live-2026-10-10-356e6fe/r1-5-1-evidence.json) | 先澄清forecast/specifications整行范围及官方具体产品，再逐字段验证。<br>需官方范围/身份资料和另批请求；不把forecast分支代表整行。 |
| XX-K01 | BLOCKED / NOT_RUN | 一次安全链transport尝试仅fetch_failed；无底层错误/HTTP响应。 | 已有系统DNS及安全失败诊断可复用，不能归因JS/CA/反爬。<br>无合规原页字段证据；仅目录 | 单独批准一次有界底层错误诊断，先保留安全拒绝与精确URL范围。<br>需要另批诊断；不切工具/改网络/盲目重试。 |
| XX-F01 | NOT_RUN / NOT_RUN | 整页日期段落版本对比合同未落地；无合法存档/可复现字段回放。 | 仅目录产品身份；不是已配置的list。<br>无合规原页字段证据；仅目录 | 先确认整页版本、时间角色和许可，取得合法样本后决定最小适配。<br>需要许可/样本/合同，网络另批；不自行抓全文。 |

## 10个资讯字段未PASS来源

对应上表同一材料与许可，不重复计数。unknown不补造时间，缺href/冲突不造身份。

| ID | 当前字段判定 | 未完成的字段链 |
| --- | --- | --- |
| CN-P02 | NOT_RUN | NOT_RUN retained: no list or distinct target payload; only one root302/header capture, no title/identity/date adapter or field replay. |
| CN-T01 | NOT_RUN | No stored real-page full title/link/source-time replay. |
| VN-P01 | PARTIAL | Complete saved table inspection found title/link but no visible date/date attribute; TBHH identifier and header cannot substitute for date. |
| MY-P03 | FAIL | Full actual raw repeated URL with conflicting title/date; collector fails closed. No selection/merging to manufacture a pass. |
| MY-L01 | FAIL | Full private original page suitability probe fails closed on missing detail link, committed0; no hidden interface or inferred slug used. |
| PH-P01 | NOT_RUN | No stored real-page full title/link/source-time replay. |
| PH-W01 | NOT_RUN | No stored real-page full title/link/source-time replay. |
| PH-W02 | NOT_RUN | No stored real-page full title/link/source-time replay. |
| XX-K01 | NOT_RUN | No original news-list payload obtained, no title/link/time parsing or collector/SQLite replay. |
| XX-F01 | NOT_RUN | No stored real-page full title/link/source-time replay. |

MY-L01的本轮变化仅是十条源时间从unsupported变为明确的本地日期/分钟精度，时区和发布时间仍未知，身份href仍缺失；不是该源R2-5 PASS。三个数值非OK来源（ID-W02、XX-W01、XX-W02）不强套资讯标题/链接/时间分母；本表中MY-P02字段已PASS，不重复开门禁。

## 下一步建议（未授权、未执行）

优先让主审确定能提供的官方产品/原日期/稳定链接资料；不整批重试14项。若只批准一个无需猜URL的近期可用性复核，可选MY-P02同一精确Feed：`https://www.westportsholdings.com/category/press-release/feed/`，上次取样2026-10-15，本次未请求。建议上限1次物理HTTPS GET、0重试、0重定向跟随、0详情、0付费；保留现有安全链/响应大小超时/源许可，遇30x或安全拒绝即停。原件仅在另批的本地许可范围内，Git只入元数据/核算结果；近期有效title不存在则继续STALE。最多影响1/39，不能解决10个资讯字段或宣告整体R2通过。

这只是可审提案，不能自行执行。CN-P02自指、CN-T01协议、MY-P03冲突、MY-L01无href、BMKG港口映射及JMA产品等需要前置资料，不用重复GET替代。
