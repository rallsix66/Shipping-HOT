# MY-W01 既有合同复用与验收映射 — 2026-10-15

本批 **零上游请求、零系统DNS**。执行起点 `f5ffcda5629343456bd74ee0264c6e7c02dc448a`；产品仍 `bebe1441465adfcabb9daf93cb2a8656ec1fc796`，无产品/迁移/目录/身份或存储合同改动。两媒体批已获限定认可，当前计数仍 **R2-4 21/39、R2-5 18/34、数值3/5**。本批离线核验通过，父会话审查pending；不把既有Feed链升级为R2 intel资格。

## 谱系更正

前轮将不同实跑的大小作了错误关联，并漏读已批准parser。**7688字节是10/10 07:54Z早期probe；7754字节是08:30Z integration另一实跑**，二者不同不能证明存档不匹配。08:30 [live-evidence](../metmalaysia-integration-2026-10-10/live-evidence.json)明确记录尾斜杠URL、08:30:40.790Z请求、200、7754字节、4条入库。当前完整存档文本与该次 `.tmp/metmalaysia-live-eab30a7/warning-raw.json` 相同，UTF8字节长度7754，文本artifact SHA256 `24d20e53b4ca59547c83ecfccea542ab11e0da094e863da3a2de40adb4124ebf`。

历史harness `scripts/r1-5-metmalaysia-live.ts` 保存的是 `response.text()`，记录 `Buffer.byteLength(text)` 并写UTF8文本。故结论是 **完整响应文本和实跑来源已记录**，不能声称响应原始wire字节/hash已验证。没有据此预设必须重抓。[谱系核验](provenance-correction.json)。原始错误说法及其f5ffcda版本保留在Git和 [更正前文本](superseded-texts.json)，现役frontier/report/status/handoff已纠正。

## 复用的批准合同与离线证据

复用 `server/providers/metmalaysia-warning.ts` 的 `parseMetMalaysiaRows`、`metMalaysiaRecordKey`、`parseMetMalaysiaWarnings`；继而使用现有 `createOfficialWeatherAlertProvider` → `createWeatherAlertSyncJob.run()` → `ShippingRepository`/SQLite。没有新parser或平行身份模型。

| 已批准语义 | 本次08:30完整文本核验 |
| --- | --- |
| 身份 issued + title_en + validFrom + validTo | 4个稳定Feed ID与原实跑一致；同issue/标题但有效区间不同的两条保持独立 |
| 统一来源URL | 四条canonical/source均为已批准provider URL `https://api.data.gov.my/weather/warning/`，不造文章URL |
| 首次接收时间 | publishedAt=首次接收08:30:40.728Z，timeBasis=received_at；重启后再次同步首次接收保持，抓取/观测时间推进 |
| issued/validity原文 | issued/validFrom/validTo原串、正文等raw字段逐字段相同，不转UTC、不补+08；4条时区/有效性unknown |
| 无推断影响 | eventEligibility=false、无结构化区域、无港口关联、官方级别not_provided；Klang面板预警/影响及规则命中均0 |
| No Advisory | 独立1条，其余3条保留；不代表全国无预警，不清空其他类型 |
| 存储/重开 | Feed当前4条；重复仍4个ID、首次接收不变。readonly+query_only经真实ShippingRepository复读及全量feed/history快照0差异，库字节不变 |

重复sync结果仍 `recordsRead=4/recordsWritten=4`，这是Feed的upsert操作数，**不能称为intel零修订/零新增版本**；Feed历史观测可增加。本次 `intel_item/intel_item_version/intel_fetch_run` 均0，清楚区分存储链。[Feed回放](feed-replay.json)保留4条最小字段审计；完整输出/隔离库仅ignored `.tmp/r2-my-w01-contract-2026-10-15-private/`。只使用原存档，不请求上游，不新增远端正文。

现有14项MetMalaysia测试 + 本轮3项离线验收 **17/17 raw exit0**，涵盖既有失败/空数组区分、固定URL/限速、未知语义及重启。两个测试文件的TCP/DNS/global fetch守卫均0尝试。第一次16/17因本轮负例对报错层级预期错误失败：静态urlTemplate先被配置校验拒绝，而非链接校验；更正离线断言并增加缺link负例后17/17通过，未改产品。原始失败 [command.first](command.first.json)、初版过程与最终 [command](command.json)均保留。

## Feed与R2 intel的具体差距及最小建议

1. **已具备，直接复用：** 专用parser、原始日期/未知语义、稳定4字段身份、共享来源URL、首次接收时间、已有Feed存储/限速/测试链。未知时区和无官方级别是批准合同，不是要求补齐或另造合同的缺陷。
2. **当前未接线：** R2 `collectIntelSource`只分派RSS/web_list/json_list；MY-W01不在活动seeds/生产允许选择范围。不能把Feed replay称为R2 collector/immutable版本/Runtime已运行。[兼容性负例](intel-compatibility.json)验证未选择、默认关闭。
3. **无法纯配置桥接的精确原因：** generic JSON要求带字段占位的urlTemplate；常量共享URL报 `urlTemplate placeholders invalid`；源无article-link字段的urlPath映射报 `json_list_invalid_link`。`intel_item`现有唯一键是 `(source_id, canonical_url)`，与Feed按4字段派生ID、4条共享canonical URL不同。不是源缺身份，也不应伪造URL来迎合该约束。
4. **最小后续接线建议（未实施）：** 在现有collector的来源归一化入口复用上述parser和key，保留共享URL与每记录稳定身份；存储侧需先明确如何在既有intel版本链承载“记录身份”和“展示来源URL”两个不同概念。若选择持久化桥接，精确差异至少涉及 `IntelEntryWrite/IntelRepository.writeEntry` 以记录身份去重而非共享URL，以及021/022后续唯一约束/标识字段的批准迁移；不能在本轮直接改。日期映射应保留原issued未知时区，接收时间使用既有firstSeen/fetched语义并保留received_at标记，不能把接收瞬间伪装成source_published_at。也可先在验收映射中记录现有Feed证据而不复制存储；这同样须主会话按当前验收裁决，不能自动等于R2通过。
5. **目录差异独立列审：** 目录无尾斜杠；已批准Feed provider固定尾斜杠、早期301 Location已记录。本轮不改目录，也不为运行parser再求一次身份或URL批准。若后续统一目录/collector产品落点，仅提出该精确一字符差异供审。

若主会话选择物化到R2 intel，以下是需要先审的精确存储差异，不是本轮已实施方案：

| 位置 | 当前 | 需审差异 |
| --- | --- | --- |
| intel_item去重 | UNIQUE(source_id, canonical_url) | 允许独立record identity key与展示canonical_url分开；MY值直接复用既有Feed ID/四字段key，保留四条同URL记录，不能另造文章URL。既有来源可继续以原canonical_url作为身份，不能改旧去重语义。 |
| IntelEntryWrite/writeEntry | 按source+URL查找与生成item | 可接收既有稳定record key并按source+key查询；只有选择上述物化方式才需要批准的additive迁移/唯一约束变更，本轮不实施。 |
| 日期映射 | intel source_published_at与WebDate；Feed接收时间另有received_at语义 | 不将Feed received_at写成source publication instant；保留原issued/validFrom/validTo未知语义与firstSeen/fetched。若现有版本审计结构无法无损承载，应列具体类型/字段扩展再审。 |

仅引用既有Feed证据的验收映射可以先零代码审查，不必先执行上述迁移；是否满足现有R2条款由主会话判断，本轮不改口径或计数。

R2-4仍PARTIAL、R2-5仍NOT_RUN，整体R2未通过；本批只补充可复用Feed链和缺口证据，不改变验收口径。无需从零设计parser，也不预定重抓或新网络预算。MY优先是本轮选择，**不代表其他来源没有可复用实现**：如NMC专用provider/fixtures/tests、JMA既有forecast链仍按各自证据保留，通用intel列表失败不能抹去专用链。

完整产品install/typecheck/lint/full test/build、GUI/S7/24h本轮NOT_RUN；无产品变更，单独做证据/Markdown验证与真实Neat Freak收尾。没有生产开关、网络设置、真实LLM/付费、merge/deploy/force-push，所有复核现场保留。
