# MY-W01审定收尾与既有天气证据复核 — 2026-10-15

执行起点 `16ae7b7c1f2e149caeceea0c727d7dba788d272c`；产品代码仍 `bebe1441465adfcabb9daf93cb2a8656ec1fc796`。本轮 **上游HTTP0、系统DNS0**。仅落实用户审定的MY-W01归类/目录修正，以及13项矩阵天气来源的有界证据复核；其余40项矩阵条目原样保留，不自动新增其他资格。

MY-W01现为 **历史实测OK / 4条真实存档回放PASS**，累计 **22/39（最少32，差10）与19/34（差15）**，数值有限历史诊断仍独立 **3/5**。样本是 **2026-10-10T08:30:40.728Z**，不是今天实网、持续在线或24h通过。其issued/validFrom/validTo原串仍无已知时区/有效性，Feed publishedAt为首次接收且timeBasis=received_at，港口关联/推断影响0。复用既有天气provider/Feed表是方案已有设计；R2-4/5原文未要求独立文章URL、已知UTC、必须写intel表或wire字节hash。完整response.text()及实跑来源、4条字段复读已足够作为本次审定实录。原wire hash未记录是事实边界，**不是追加门槛**。[前轮17项离线验收](../r2-my-w01-contract-2026-10-15/command.json) / [4条字段](../r2-my-w01-contract-2026-10-15/feed-replay.json) / [原实跑](../metmalaysia-integration-2026-10-10/live-evidence.json)。

目录只将MY-W01 `https://api.data.gov.my/weather/warning` 改为已批准、已实测同产品 `https://api.data.gov.my/weather/warning/`；主机、许可、方式、优先级和生产配置均不变。[精确变更](catalogue-change.json)保留前后行/hash；旧301 Location `/weather/warning/`证据仍为[早期fetch-log](../metmalaysia-warning-2026-10-10/raw/fetch-log.txt)。没有新请求、跟跳转或source配置实现。

## 13项天气来源：复用与真实边界

以下是复核材料和候选，**除MY外不改变既有判定**。保存文本/专用provider/天气表可以复用，generic intel适配并非新增资格硬门槛；也不能用这一原则覆盖后来的实际失败、空样本或产品未覆盖。[逐项机器记录与引用](weather-review.json)。

| ID | 可复用的实测/实现链 | 失败、生命周期与真实缺口；本轮处理 |
| --- | --- | --- |
| MY-W01 | 10/10 08:30Z，200/7754响应文本4条；已有parser/provider→sync job→Feed SQLite，前轮重启/重复/query_only复读 | 用户已审定OK/PASS；unknown时区/有效性、received_at、0港口影响保持；不要求intel物化，不新抓 |
| CN-W01 | 10/11 01:38Z NMC专用provider六固定产品页6/6→SQLite/API/Feed展示；有原页/专用parser/测试可复用 | 10/13 03:55Z该目录页generic列表真实FAIL、0条/web_list_invalid_link必须保留。两链并列，不用旧6/6抹掉后失败。时区/有效性未知、历史产品/解除语句不充活动预警；维持PARTIAL/FAIL，逐项交审 |
| CN-W02 | 同上；对应全国预警目录产品页有专用原时文保留链 | 同样保留10/13失败与缺/不支持日期事实；不得借“天气复用”擅自升格，维持PARTIAL/FAIL |
| VN-W01 | 10/10 09:52Z，列表+12文章；专用NCHMF postId身份、原时间/级别、Feed SQLite/API展示；另有R2旧5条列表DOM字段回放 | 实跑8成功/4 PDF-only空正文失败，历史job误写success，be78026已修失败传播。本轮22测试验证partial/all-failed确为failed；既有OK/PASS仅原受限字段范围，不能说13请求全链成功/全国覆盖。unknown生命周期/0港口影响、配置+07非源声明保留 |
| TH-W01 | TMD 10/10索引7+CAP正文7，Update后存4（当时2active/2expired）；专用CAP/provider→SQLite/panel，后续10/13 RSS10条是另批 | Actual/Update/Cancel、sent时钟门槛/expires/geocode与失败保留链可复用；当时TH-20未覆盖=0影响，不是今天无风险；不可把RSS字段10条说成当前10条active。已有OK/PASS保持 |
| ID-W01 | BMKG旧/en索引12+CAP原件；10/10 07:02Z另次live9条active；10/13精确/rss.xml13条；专用CAP/provider/SQLite/panel可复用 | 三个样本不拼为同份。polygon才关联，Jakarta当时未覆盖=0影响；消失/过期/失败/缺expires区分保持。已有OK/PASS保持，不以最新13条替代旧12条回放或9条生命周期实跑 |
| PH-W01 | 10/10 11:03Z目录HTML200，官方原文“No Active Tropical Cyclone within PAR”；有存档/空状态结构和接入提案 | 不应仅称JS空壳，也不是活动公报：没有正样本身份、发布时间、PDF/有效期/更新取消链；不能当菲律宾无预警或活动覆盖。仍PARTIAL/NOT_RUN |
| PH-W02 | 同时段HTML200，原文“As of today, there is no Weather Advisory issued”；存档可复用作受限空状态材料 | 没有活动正样本，未知发布/有效期/等级/区域/撤下语义；200与空状态不是失败，也不是活动字段PASS。仍PARTIAL/NOT_RUN |
| ID-W02 | 目录给BMKG海况根/文档/港口KODE模板；数值类别已另列 | 无已确认具体产品/KODE与实际数值样本；缺的是产品/数据证据，不是未写intel表。仍NOT_RUN，不扩鉴权/许可 |
| XX-W01 | 10/10 03:58Z JMA targetTc与持久化气旋ID诊断，既有JMA/provider/天气表、重启/API/浏览器证据可复用 | 数值列表，不造文章标题/UTC要求。当前3/5中的有限诊断保持；不是今天存在活动台风、不是24h。旧单次未留逐请求JSON不自动变成新硬门槛 |
| XX-W02 | 同批forecast分支及持久化气旋字段，已有适配器/测试可复用 | 目录还有specifications.json未证明；forecast部分成功不能当整行成功，推导TC URL不能冒充实际请求。仍PARTIAL，数值诊断PARTIAL |
| XX-A01 | 10/10 03:58Z Open-Meteo八港陆地点风/雨/能见度与时间，SQLite→重启API→浏览器对照 | 已有有限数值诊断保持；当时169小时窗口不代表今天fresh或当前7天，无需落intel表。生产商业许可仍后续范围 |
| XX-A02 | 同批7港原点海况+后续ADR-009独立参考点链；波浪/涌浪与时间、天气表可复用 | 早期356e6fe整体BLOCKED因VNSGN原点缺测；后续ADR-009映射通过是独立参考约61.8km，绝不覆盖原点缺测/冒充泊位。有限3/5保持，不说8原点齐全或今天窗口已验 |

NMC证据层级需要下一轮逐项审查：旧专用链确实存在；后来的generic列表失败也确实存在。两者是否满足R2原条款应按具体字段与产品语义审，不额外要求新parser/文章URL，也不直接用本轮夹具通过覆盖后失败。PAGASA需活动正样本才能讨论活动公报字段覆盖；本轮未抓且不猜地址。NCHMF部分失败的旧job success只作为历史缺陷原件保留，不作为成功证据。

## 本轮离线验证和范围

仅运行既有4个provider测试文件：NMC16、NCHMF22、TMD48、BMKG15，共 **101/101 raw exit0**。没有新增parser/身份/架构或改fixture；专用storage/runtime测试核对partial/all-failed、空状态、Update/Cancel/过期/旧值保留等语义。四文件TCP/DNS/global fetch守卫均0尝试，且检查守卫仍生效。[命令原输出](offline-command.json)。这些是已有真实/合成夹具的离线验证，**不是新实网、不是四源新资格，也没有重跑10/13 NMC失败探针**。MY的前轮4条回放不重复执行，直接复用其精确提交证据。

本轮product install/typecheck/lint/full Vitest/build、GUI/S7/24h均NOT_RUN。Markdown/证据验证和真实Neat Freak另记；不改生产/Runtime开关、迁移、许可、阈值，不付费、不发真实LLM，不merge/deploy/force-push。样本日期及失败原件全保留，当前R2整体仍未通过。
