# 官方缺口有界取证 — 2026-10-15

执行起点 `cfce1b3f0a1cccf8cc61527f5aebea879a8a1aec`，产品仍 `bebe1441465adfcabb9daf93cb2a8656ec1fc796`。用户授权四个固定入口及条件追加最多三次，共最多七次 GET。本轮在 **2026-10-15T05:21:25.064Z–05:21:25.075Z** 完成四次逐目标系统 DNS；均在既有安全入口 `blocked_address`，**GET 0、响应 0、原始响应字节 0**。没有重试、跳转、改 DNS/代理/CA 或更换工具绕过阻断。

| 来源 / 精确目标 | DNS 次数 / 返回 IPv4 | GET 次数 | 本次结果 |
| --- | --- | --- | --- |
| PH-W01 `https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin` | 1 / `198.18.0.85` | 0 | BLOCKED；HTTP status=null，未观察到本次页面/空状态/活动内容 |
| PH-W02 `https://www.pagasa.dost.gov.ph/weather/weather-advisory` | 1 / `198.18.0.85` | 0 | BLOCKED；HTTP status=null，未观察到本次页面/空状态/活动内容 |
| ID-W02 根 `https://maritim.bmkg.go.id/marine2026-data/` | 1 / `198.18.0.86` | 0 | BLOCKED；没有根响应，不知道是否有官方 apidoc 链接或港口 KODE |
| XX-W02 列表 `https://www.jma.go.jp/bosai/typhoon/data/targetTc.json` | 1 / `198.18.2.99` | 0 | BLOCKED；没有列表，不作“空列表”判断，未选择气旋 |

三主机均返回 `198.18.0.0/15` 内保留地址，符合 fake-IP 地址形态；这不是来源站点 HTTP 失败，也不能仅凭地址断定具体网络组件的原因。既有 `secureFetchArticle` 的全部地址检查在调用 `defaultTransport` 前拒绝，完整原错误 message 和逐项时间见[采集结果](capture-summary.json)、[DNS 台账](dns-ledger.json)、[空 GET 台账](request-ledger.json)。没有 HTTP 响应，所以没有 status/Location/body/hash 可补造。

## 条件请求均未启动

- BMKG apidoc：根未返回响应，未出现可审核的同主机真实链接；追加 GET/DNS 均 0。没有把目录里的 `/apidoc` 猜成完整 URL，也没有请求任何 `/pelabuhan/{KODE}.json`。Jakarta/Tanjung Priok 官方 KODE 仍未知；目录“无需鉴权”的原说明保持，不要求密钥或付费。
- JMA forecast/specifications：targetTc 没有返回对象，追加两次 GET/DNS 均 0；不硬请求 TC2634/2635、不枚举气旋。两产品原目录范围不变，specifications 仍未实录。
- PAGASA PDF：下载 0；本次没有页面，因而没有新观察到的实际 PDF 链接。10/10 两入口的官方局部无活动状态按原历史范围保留，不能写成今天的空状态、活动覆盖或全国无风险。

最多七次 GET 的额度本次实际使用 **0**，不是有七次可重试额度；四个固定目标已各检查一次，相关项已停止。本轮没有新的成功或成功空响应，只有四个安全阻断。后续若恢复本机网络条件，先针对上表三个精确主机报告/核实，再由主会话安排新的有界批次；本执行不修改网络设置、不重测。之后仍沿原条件：PAGASA 只看两入口真实状态和身份/时间/区域，PDF 只记录真实链接；BMKG 只按根中真实同主机 apidoc 链接取一份文档，先证官方 KODE；JMA 只选当次有效 targetTc 的一个真实标识取同一对象两产品。

## 许可、验证与状态

采集前 [manifest](manifest.json) 已把原件限定为本地 ignored `.tmp/r2-official-gaps-20261015-private`，持久化许可 `disallowed`；远端只保存必要 URL、DNS、时间、错误、程序及输出/hash，不保存响应头 Cookie、凭据或原始全文。本次没有收到原件，私有目录为空，未创建新数据库。

采集 harness **1 项 raw exit 0** 只证明有界程序完成并守住次数上限，不代表来源通过。原始 stdout/stderr/hash 见[命令](capture-command-initial.json)。Vitest 原有重复自动导入提示保留；外层固定参数 wrapper 的 Node DEP0190 提示如实记录，没有据此重跑请求。

资格完全不变：**24/39、21/34、数值 3/5**，NMC 前批限定认可保持；整体 R2 未通过。当前矩阵只追加四项目标的本次 DNS 尝试，不覆盖任何历史真实响应、字段回放、许可、默认状态或资格。文档定向验证、Markdown lint、归档/hash、正常提交钩子和真实 Neat Freak 单列。产品代码未改，完整产品 install/typecheck/lint/full Vitest/build、GUI/S7/24h **NOT_RUN**。无 Provider/目录/迁移/阈值/生产改动，无真实 LLM、付费、merge/deploy；本批待父审查。
