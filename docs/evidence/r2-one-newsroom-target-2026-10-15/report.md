# ONE 已保存308目标核验、受限JSON适配与目录提案 — 2026-10-15

本轮只对先前已保存的 ONE Location 单独核准目标做一次系统 DNS、一次 GET；**没有自动跟随跳转，Maersk真实请求0**。原目录 `https://www.one-line.com/en/news` 保持不变，先前308原件保留在[原响应派生](../r2-carrier-reapplied-2026-10-15/XX-K02-response.json)。`/en/newsroom` 按标准 URL 解析得到同HTTPS主机目标 `https://www.one-line.com/en/newsroom`，不是猜测其他路径。

## 本次实网结果与身份

执行 HEAD `03d1515d33dd1c5d96137c43e0aafb596b334be3`，当时产品代码为 `355952c0e8c01266adbe692dfcfd3bca9b3c17b2`；不能把后续解析器测试SHA冒充实际抓取SHA。[完整结果](summary.json)、[DNS](dns-ledger.json)、[请求台账](request-ledger.json)、[执行绑定核对](capture-integrity.json)均保存原依据。

| 项目 | 实测 |
| --- | --- |
| 系统 DNS | 2026-10-15T02:56:19.741Z；`104.19.145.47`、`104.19.144.47`，公网检查通过 |
| 实际 GET | `https://www.one-line.com/en/newsroom`，一次，原安全入口固定地址；无重试/详情/分页/接口 |
| 响应 | 2026-10-15T02:56:22.136Z，HTTP200，`text/html; charset=utf-8`，635664字节 |
| 原字节 SHA-256 | `682943942c38c8aebcbc68ec3888ca65e9278ed27a38d30a11134d283d893fe0` |
| Location | 本次响应未提供；先前308的 `/en/newsroom` 继续独立保留 |
| 解码 | HTTP与meta均UTF-8，无声明冲突；原字节在解码前留存并检查1MiB上限 |

HTML标题为ONE的新闻/新闻稿更新标题，h1为 `Newsroom`，canonical精确指向本目标；内嵌JSON的page为 `/newsroom`。这些与原308链共同确认对应新闻产品，没有用200单独判字段合格。正文DOM无新闻卡片/时间，不能把DOM观察的0候选当作原页没数据：实际 `script#__NEXT_DATA__[type=application/json]` 含 `props.pageProps.pinArticle` 一条及 `props.pageProps.articles` 九条，均有 `title`、`aliasUrl`、`releaseDate`。只读原页数据，没有下载任何脚本或隐藏接口。

完整未知许可原字节仅本地ignored：`.tmp/r2-one-newsroom-target-2026-10-15-private/XX-K02.response.bin`。远端仅必要元数据、过程、hash；无完整HTML/JSON、Cookie或凭据。标题/原链接/源日期的有限派生见[十条字段](../r2-one-newsroom-replay-final-2026-10-15/raw-field-metadata.json)。

## 同一适配器的最小受限扩展

后续源码 `01934a5746c10d4165f4c4ffc5ce145d6de33d16` 只改现有 `json-list.ts` / collector及两测试文件，没有新调度器/Provider/parser体系、迁移、日期语法、网络设置或永久来源配置。

- 可选 `htmlScriptSelector` 必须唯一命中无src的 `script[type=application/json]`，只读文本后 `JSON.parse`，不求值JavaScript、不找window变量、不执行脚本、不发现/请求新URL。缺失、多份、可执行type、外部script、坏JSON均失败，无片段泄露或宽松回退。
- 可选 `itemsPaths` 是至多4个受限自有属性路径，每组为数组或单对象，总量上限仍500；与旧 `itemsPath` 互斥，禁原型路径和重复路径。合并组同URL仅完全相同的标题/正文/完整日期证据可去重，冲突在存储前失败。旧单数组语义与身份不变。
- 仅显式HTML数据脚本模式的安全入口原字节及解析后的UTF-8文本上限为1MiB，以容纳原635664字节；其他JSON、RSS、web_list保留原512KiB默认。HTML模式/纯JSON模式严格匹配各自Content-Type白名单；DNS/TLS、URL及超量失败保留旧数据的边界不变。

ONE配置只存在[离线typed候选](../r2-one-newsroom-replay-final-2026-10-15/candidate-config.json)，`enabled=false`、`persistence=disallowed`，实际仅metadata标题块。未加入永久候选、active registry、生产允许列表或Settings，不预先改目录。原始 `aliasUrl` 按标准相对URL解析，未凭语言猜补 `/en`；未请求详情验证。

## 原页到SQLite的独立证据

[最终回放](../r2-one-newsroom-replay-final-2026-10-15/summary.json)使用**完整635664原HTML字节**进入现有安全入口/解码/collector，未把抽出的JSON伪装成HTTP响应。首次10 items/10 versions，重复0新、0修订；lastSeenAt按第二次时钟正常更新，其他item字段及全部versions保持。只读native SQLite重开，不初始化/迁移；十条完整标题、原URL、完整日期证据逐一与原始JSON字段和解析结果对照，0差异，10个metadata-only标题块，重开数据库字节hash不变。

十条 `releaseDate` 仅为源字段标注的本地秒精度时间，全部timezone missing、utcOffset和publishedAt为null；不猜公司所在时区、不认证UTC发布时间、不推断港口影响。置顶和列表共10条均核对，没有为复用数组配置而漏掉置顶。

初次回放脚本错误地要求正常更新的lastSeenAt也不变，退出1；[原始失败命令/日志](../r2-one-newsroom-replay-2026-10-15/command.json)及原库/过程保留。只修离线断言，将lastSeenAt单独验证为新时钟，其余身份/标题/URL/版本全量不变；产品代码没有因此再改，也没有重抓原页。最终回放退出0，测试范围Socket连接与全局fetch守卫均0尝试；注入的是保存字节和固定测试地址，不能称实际外呼。

## 错误记录与干净代码门禁

采集脚本现在分别记录脱敏transport code/message和安全入口code/message，保留必要原因，限制512字符、不存stack；URL凭据/查询/片段、token、Authorization、Cookie等脱敏。[合成失败](error-recording-offline-result.json)及[原命令](error-recording-offline-command.json)验证 `ECONNRESET` 与 `fetch_failed` 记录/脱敏；只有假transport，无真实DNS/HTTP。它不诊断Maersk旧失败，Maersk底层原因仍未知，本轮未重试。

代码01934a5在全新隔离clone、Node24.15.0/ABI137下 frozen install正常scripts、build/typecheck/lint、17文件244定向、129文件1229全量通过/3既有跳过、3个隔离smoke均raw exit0。[精确门禁](../gate-01934a5-one-newsroom-json/summary.json) / [源码与计数核对](../gate-01934a5-one-newsroom-json/source-proof.json)。测试源码diff0，根保留DB/secret-file摘要不变。安装联网与来源请求分开，不用用量未变单独证明无外呼。GUI/S7本轮NOT_RUN（无UI/路由变化），原GUI待验限制保留。

## 覆盖与待审目录差异

ONE按**已保存308链、单独核准同主机目标、对应Newsroom身份和10条真实字段回放**计R2-4 OK / R2-5 PASS；不是称原目录URL直接返回200或已正式接入。当前累计 **21/39**（至少32，差11）和 **13/34**（差21），数值有限历史诊断独立3/5；[矩阵差异](matrix-delta.json)确认其他40来源逐项不变。默认开关、全部41库存/分母/阈值不变，整体R2未通过、24h NOT_RUN。

[目录提案](catalogue-url-proposal.json) / [仅一行URL差异](catalogue-url-proposal.diff.txt)：建议把XX-K02 URL由 `/en/news` 改为已实证的 `/en/newsroom`，其余列不动；**PROPOSED_NOT_APPLIED**，永久目录原文件hash不变，需按既有目录权限审查。当前默认关闭离线候选不等于生产接线；后续先审目录与配置落点，本轮没有后续网络预算。

无新迁移、永久白名单/源注册/生产开关、24h、付费/LLM、merge/deploy/force-push；旧Maersk、Northport、VN-P01、MY-L01及跳转/数值缺口不重查。真实Neat Freak与保留现场见[closeout](closeout.md)；[当前矩阵](../r2-current-source-matrix-2026-10-14/mapping.json)与[交接](../../handoffs/r2-next-execution-2026-10-15.md)已同步。
