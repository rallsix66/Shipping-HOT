# R2 Maersk / ONE 两源 DNS 证据与收尾 — 2026-10-15

本批仅取得两次系统 DNS 结果。现有安全检查均在 HTTP 前阻断；两源为 **R2-4 BLOCKED / R2-5 NOT_RUN / 解析 NOT_RUN**，不把环境阻断当成页面或字段不合格。没有重试、跳转、详情、分页、替代域名或隐藏 API 请求。

| 来源 | 目录精确 URL | 精确主机 | 系统 DNS UTC | 实际地址 | DNS / HTTP |
| --- | --- | --- | --- | --- | --- |
| XX-K01 Maersk | https://www.maersk.com/news | `www.maersk.com` | 2026-10-15T02:03:12.613Z | `198.18.0.217`（IPv4） | 1 / 0 |
| XX-K02 ONE | https://www.one-line.com/en/news | `www.one-line.com` | 2026-10-15T02:03:12.621Z | `198.18.0.218`（IPv4） | 1 / 0 |

依据为 [DNS 台账](dns-ledger.json)、[空 HTTP 台账](request-ledger.json)、[逐源结果](summary.json)。地址属于现有 `blocked_address` 检查拒绝的特殊范围；符合 fake-IP 形态，但单凭地址不能确证成因。没有 HTTP 响应，故状态码、Content-Type、响应字节/原文哈希及 Location 均未取得，不能记成状态 200、空正文或“没有 Location”。未知正文许可继续仅 metadata；没有第三方原页可重放或发布，未新增来源配置。

## 真实执行与 SHA 绑定

采集实际执行 HEAD 为 `a5da09871d1a017ae947a0f3f56980461807bfaf`，其中产品代码对应已审查的 `355952c0e8c01266adbe692dfcfd3bca9b3c17b2`；两提交之间只有文档差异。原始 [launch.json](launch.json) 已记录这两个正确值，[command.json](command.json) 记录同一执行 HEAD、起止时间和 raw exit 0。这个退出码只表示有界诊断及阻断断言成功，不表示来源可用或功能门禁通过。

复制的诊断过程在 manifest 中误写了旧代码标签 `355bc861d4020ba22ddd00401de709d7cee497e3`。已保留 [原 manifest](manifest.original.json)，在 [当前 manifest](manifest.json) 修正，并在 [execution-binding.json](execution-binding.json) 保存原件字节哈希、错误标签、核对依据和目录行哈希。归档的 [实际执行过程](capture-procedure.test.ts.txt) 仍保留当时的旧标签，未事后改成另一份“已运行脚本”。没有因此重新采集。

诊断继续使用既有安全抓取入口，地址检查、TLS 和固定地址边界未弱化。单响应上限为 1 MiB（目录注明 ONE 页面约 635 KB），DNS/请求各限 10 秒、全批 60 秒、最多两次 DNS/两次 HTTP；实际 HTTP 为 0。这是临时诊断上限，没有修改产品默认值。原始 stdout/stderr 的准确 UTF-8 字符串和字节哈希保存在 [capture-output-original.json](capture-output-original.json)，相邻展示日志只修整行尾空白。

## Clash 只读主机存在性

2026-10-15T02:11:19.914830Z 只提取当前订阅/脚本关联、目标主机字面量和 DNS 过滤字段，未检查或导出凭据字段、订阅地址、代理条目或完整配置。没有求值扩展、调用控制器、修改设置或额外 DNS/HTTP。

| 精确主机 | 当前选中订阅扩展 | 全局扩展 | 磁盘生成 `fake-ip-filter` |
| --- | --- | --- | --- |
| `www.maersk.com` | 不存在 | 不存在 | 不存在 |
| `www.one-line.com` | 不存在 | 不存在 | 不存在 |

生成文件 `clash-verge.yaml` 的 `enhanced-mode` 为 `fake-ip`，过滤表仍 21 项。基础 `config.yaml` 没有 DNS 块，不把它误认成生成配置。检查前后相关文件的大小和修改时间一致；这只是磁盘存在性证明，不等于核验正在运行的内核配置。详见 [必要派生结果](clash-host-presence.json) 与 [只读过程](clash-readonly-procedure.py.txt)。

## 当前矩阵与最小下一步

[唯一当前矩阵](../r2-current-source-matrix-2026-10-14/mapping.json) 仅这两项来源记录改变，[差异核对](matrix-delta.json) 确认其余 39 项逐源记录完全一致。公开可用性仍 **20/39**（20 OK、11 PARTIAL、1 STALE、2 BLOCKED、5 NOT_RUN；至少 32，差 12）；资讯原页字段仍 **12/34**（差 22）；数值有限历史诊断独立 **3/5**。24 小时仍 NOT_RUN、整体 R2 未通过，默认启用和许可未变。

最小下一步：由主会话协调用户为当前订阅补齐并应用 **`www.maersk.com`、`www.one-line.com`** 两个精确主机的既有 DNS 例外，保留原 21 项；之后先只读确认生成配置，再由主会话明确安排新的有界两源核验。本次收尾没有修改配置或授权自动重试。旧 Northport、VN-P01、MY-L01、CN-P02/ID-T02 缺口不在本轮重查范围。

本轮不改产品代码、不安装依赖、不跑 typecheck/功能测试/build/S7，不启动服务、启用生产、24 小时、付费或 LLM。只做文档、哈希、矩阵与链接核对；原代码门禁仍独立保存在 [355952c 门禁](../gate-355952c-anchor-date-repair/summary.json)，不得冒充本轮执行。归档哈希见 [archive-hashes.json](archive-hashes.json)，实际 Neat Freak 见 [closeout.md](closeout.md)，后续执行见 [仓库交接](../../handoffs/r2-next-execution-2026-10-15.md)。
