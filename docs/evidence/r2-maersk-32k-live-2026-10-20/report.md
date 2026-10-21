# Maersk固定32KiB单次真实验证（2026-10-20，待父审）

本机`D:\try one\Shipping HOT`，`codex/shipping-hot-r2@40629587e22d8932df105962ec214530e4054414`加保留未提交候选。父已独立只读审查三份完整产品diff，无P1/P2，本轮按用户既有授权执行一次真实请求；父没有重跑执行者92项定向/1727通过＋3跳过门禁。请求前后复核交付SHA，未改产品源码、阈值、路线或来源配置。

## 请求实际结果

精确`https://www.maersk.com/news`，policy与opt-in均为`sourceId=intel:xx-k01`，`maxHeaderSize=32768`，Node全局默认仍16384。10秒/512KiB、零跳转/重试/详情/附件；系统DNS、全地址审查、连接pinning与原TLS防护保持，无sourceCA或网络配置变化。

| 字段 | 实际值 |
| --- | --- |
| 开始 | 2026-10-20T07:28:29.935Z |
| 接收 / 结束 | 07:28:30.700Z / 07:28:30.739Z |
| DNS / GET reservation / transport | 1 / 1 / 1 |
| 响应 | HTTP200，text/html; charset=utf-8，46251正文原字节 |
| SHA256 | `9e7271c8d37da91032150dfff719de6fb7fd8d30426cfad50ae123e10fd72673` |
| header参数实际转交 | 32768；实际wire header总字节未测，不保存完整header/cookie/token/rawPacket |
| raw exit | 0 |

[单次账本](request-ledger.json)保留完整必要字段。全地址均公网，传入原transport；未重新解析、没有替代IP/工具、阈值加码或第二次请求。本次在固定32KiB预算下成功，不推断与早先16KiB失败响应的header完全相同，不能从跨时点结果猜实际大小/反爬/CA或持续可用性。

完整正文仅保存到既有ignored私有样本目录下`.tmp/r2-three-url-diagnostic-20261020/maersk/response-32k-20261020.bin`，未暂存/公开。Git仅必要标题/链接/日期/统计与脱敏请求元数据。

## 完整HTML离线字段核查

标题为`News & Advisories | Maersk`，H1为`Latest news`，实际初始HTML已有字段，并非纯JS空壳；未执行script、加载资源或请求隐藏API。

| 初始返回分组 | 条目 |
| --- | ---: |
| Latest news | 12 |
| Advisories | 3 |
| Rate announcements | 3 |
| 合计 / 唯一URL | 18 / 18 |

18个非空可见标题、18个原href解析出的真实同host文章URL、18个同一item内自身可见日期节点；没有缺字段/重复item/冲突身份。页面30个article anchors中的12个为空文本图片锚点，与其标题链接同身份，不当作额外条目或冲突。原标题按可见节点保留，不按语义猜删子标签。

显示日期为`d Mon YYYY`，严格Gregorian日历核查18项有效；范围2026-09-28至2026-10-20，全部为2026，最新显示日与抓取日相同。日期来自同卡片timestamp节点，不来自URL路径/页脚/抓取时间。它们是未标注角色的卡片显示日，时区与publication instant保持unknown/null，不宣称已认证新闻发布时间或分钟级新鲜度。仅覆盖本次初始18项，不宣称分页/筛选/全部档案完整性。[逐项元数据](field-audit.json)。

## 现有parser实际回放及最小下一步

完整46251字节原件经现有`fromHtml`离线探针抽出18条title/link/rawDate，18个唯一URL；与独立节点核查对照见summary。probe测试1项通过，只验证“抽取存在且日期支持缺口如实保留”，不是R2字段PASS。

生产parser对18项日期均返回`unsupported_format`，publishedAt=null、timezone=missing。现有英文全月格式是`Month D, YYYY`，MY-L01格式另要求`DD Mon YYYY hh:mm am/pm`；不应拿这些或印尼`Okt`格式硬套本页`20 Oct 2026`。见[现有parser结果](parser-probe.json)。

下一最小离线切片建议：复用既有web_list/fromHtml，加入明确、全串、Gregorian的英文缩写月日格式（允许本页1/2位日，无时区推断）；用默认关闭metadata-only配置覆盖两个实际DOM布局及全部18项。已测候选是body唯一根、`.p-section__news__teaser, a.news-hub__panel__item`条目，标题/日期分别取各布局对应子节点，linkSelector=`a[href]`（现有el.is自链接支持适配panel锚点）。再把已批准固定header opt-in通过受校验的现有collector调用接入，而非在底层绕过source绑定。当前collector尚未转交该可选配置。

这只是后续建议，本轮没有新增格式、配置、SDK、第二抓取器或调度。后续基于本次完整原件补必要单测和按原R2-4/5的完整字段回放；不自动纳入详情/分页抓取或新增资格硬门槛。

## 验收与边界

本轮仅取证/离线探针/文档，产品代码SHA与获审交付一致，产品完整门禁不重复。机器矩阵/目录字节不改，来源仍26/39、资讯24/34，数字历史3项有限诊断＋新增1项完整原件离线解析保持。HTTP200和单次field核查不自动提升Maersk判定，待父审及最小适配。

本轮后续收到父已读截图的新增证据，依新指令追加一次[Clash最小只读诊断](clash-readonly-report.md)：版本2.5.8，07:32生成文件已含PPA/MOFCOM各1和原27项，enable_dns_settings=false，不支持当前DNS覆写缺项判断；运行核心路径查询被系统拒绝，未重试，运行态pending。未请求这两个站，也未修改/重载任何网络配置。无试跑、24h/R3、来源启用、DB/Secret/服务/插件切换、commit/push/PR/merge/deploy或删除。[真实Neat Freak](closeout.md)、文档校验、保护hash与凭证见[summary](summary.json)。
