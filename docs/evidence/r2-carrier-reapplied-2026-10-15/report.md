# 用户应用23项例外后的两源有界核验 — 2026-10-15

用户亲自添加并保存应用两域后，本轮只读确认配置，再做每域一次系统 DNS、每源一次精确目录索引 transport 尝试。没有跟随跳转、重试、详情、分页、隐藏接口、换站、清缓存或任何系统配置写入。执行 HEAD `0ad53dd63632f097e719197345a1000b0e0c1d29`，产品代码仍为 `355952c0e8c01266adbe692dfcfd3bca9b3c17b2`。

## 配置已落盘与实际 DNS

2026-10-15T02:38:17.985445Z 只读核对当前选中订阅扩展和 `clash-verge.yaml`：两者均为 **23项，且原21项加两个精确主机逐项一致**。`www.maersk.com`、`www.one-line.com` 均存在；全局扩展不含两域不是缺陷，因为当前订阅扩展已包含。未提取凭据字段、订阅地址、代理条目、完整配置或控制器秘密，也未访问私有控制器。

[配置派生核对](applied-config-check.json) 区分磁盘生成配置与运行内核：本轮未调用内核配置接口；随后真实系统 DNS 返回公网地址，证明当时这两个域名的系统解析已不再返回之前的198.18地址，不扩大为全网络或内核全部配置已验证。

| 来源 | 目录精确 URL | 一次系统 DNS UTC | 实际 IPv4 地址 | 索引 transport |
| --- | --- | --- | --- | --- |
| XX-K01 Maersk | https://www.maersk.com/news | 2026-10-15T02:38:28.356Z | `23.53.3.137`、`23.53.3.144` | 1次，未捕获完整响应 |
| XX-K02 ONE | https://www.one-line.com/en/news | 2026-10-15T02:38:28.809Z | `104.19.145.47`、`104.19.144.47` | 1次，捕获308 |

[DNS台账](dns-ledger.json)、[请求尝试台账](request-ledger.json)、[逐源汇总](summary.json) 各自独立留证。请求计数指预先登记的一次 transport 调用；Maersk不能由此断言 HTTP 已在线发送成功、收到响应头或有某个状态码。DNS地址通过既有公网检查后固定传入原 transport，不进行第二次系统解析，不降低TLS/SSRF检查、不配置CA。

## Maersk：公网解析后 fetch_failed

`https://www.maersk.com/news` 经现有安全入口返回通用 `fetch_failed`；没有捕获完整响应、状态码、Content-Type、原始响应字节/hash或Location。当前过程没有保留安全入口返回的底层错误消息/transport code，这是证据限制，不能追溯补造，也没有再次发请求。

既有源码在 `server/services/article-fetch-security.ts` 的 transport catch 将非超时/超量错误归为 `fetch_failed`；本次缺少其 message，不能判定TLS、CA、反爬、403、超时或源页面结构。判 **R2-4 BLOCKED / R2-5 NOT_RUN / 解析与collector回放NOT_RUN**。先前198.18 DNS阻断只保留为历史，不再当当前原因。

## ONE：目录索引308，保存实际 Location

`https://www.one-line.com/en/news` 的完整返回为 **HTTP308、12字节**，原字节 SHA-256：`8d3e9d688c23a2e9d23f1e8fb252bb339ce3bfb0f7bb63fbb262d4d9d07e1578`。Content-Type值未出现在采集结果中，不补造为HTML/JSON或某个编码。原字节仅本地 `.tmp/r2-carrier-reapplied-2026-10-15-private/XX-K02.response.bin`，ignored且哈希已核对；完整响应头、Cookie和未知许可原文不发布。

捕获的 **Location响应头脱敏值为 `/en/newsroom`，relative=true、followed=false**；凭据/查询/片段删除及路径脱敏标志均false。它是本次实际响应头，与之前仅存正文相对路径的CN-P02/ID-T02证据不同。未访问该目标，没有确认目标是可用新闻列表或其字段。`redirect_limit`表示有意设置跳转上限0，不表示跳转目标失败。

判 **R2-4 PARTIAL / R2-5 NOT_RUN / 解析与collector回放NOT_RUN**；308本身不够计可用OK，没有列表原页，不能猜标题/日期/时区、写默认候选或用合成夹具凑PASS。

## 当前覆盖与下一步

[唯一当前矩阵](../r2-current-source-matrix-2026-10-14/mapping.json)仅两来源条目改变，[差异核对](matrix-delta.json)确认其他39项逐源内容完全不变。R2-4仍 **20/39**（20 OK、12 PARTIAL、1 STALE、1 BLOCKED、5 NOT_RUN；至少32，差12），R2-5仍 **12/34**（差22），有限历史数值诊断另列 **3/5**；24h NOT_RUN、整体R2未通过。没有解析器、产品配置或许可变更。

交由主会话决定下一轮：ONE先核准目录产品URL是否需要改为已记录的Location目标，任何目录修改/后续请求仍按既有批准边界办理，不由本轮静默替换。Maersk若另行授权一次诊断，应在同一次 transport 脱敏记录底层错误code/message，再判断原因；不提前改CA、代理或DNS。本轮预算已用完，没有自动后续请求。旧Northport、VN-P01、MY-L01、CN-P02/ID-T02均未重查。

## 验证边界

[launch](launch.json)、[command](command.json)、[manifest](manifest.json)绑定同一产品代码与执行HEAD；[采集完整性核对](capture-integrity.json)记录私有原字节校验及错误证据限制。原stdout/stderr精确UTF-8字符串和字节hash见 [capture-output-original.json](capture-output-original.json)，展示日志只修整行尾空白。raw exit0只证明有界采集/计数断言完成，不是来源或功能门禁PASS。

本轮无产品变更，typecheck/功能test/build/S7均NOT_RUN；原已接受代码门禁仍见 [355952c](../gate-355952c-anchor-date-repair/summary.json)，不能声称本轮重跑。只有文档、结构、链接、哈希和许可范围派生扫描；见 [validation](../r2-current-source-matrix-2026-10-14/validation.json)、[归档哈希](archive-hashes.json)及 [实际Neat Freak](closeout.md)。既有重复自动导入warning保留，不是本轮产品故障证据。无生产启用、24h、付费、LLM、merge/deploy/force-push，原现场保留。

只读配置过程TXT展示行尾已规范；[准确执行原件与字节hash](applied-config-procedure-original.json)独立保存。初次暂存格式检查失败与后续修正仅涉及归档展示，不涉及系统配置或重新采集。
