# 官方补证：26项过滤列表核验后的一次性采集

执行起点 `440affa012e06b80c38d97f08b04e395b8506d0f`，产品仍 `bebe1441465adfcabb9daf93cb2a8656ec1fc796`。前批 [DNS4 / GET0 阻断](../r2-official-gaps-2026-10-15/report.md)原件不改。本次用户于 **2026-10-15T05:50:59Z** 确认已保存/应用；本执行先只读核验，再在新授权内发出 **DNS4 / GET4**。没有再次写系统设置，没有重试、跳转、替代入口或未经授权的条件请求。

## 配置核验与限制

[只读记录](clash-applied-verification.json)：选中扩展为预期26项字节，生成配置也为26项；原23项顺序完整保留，新 `www.pagasa.dost.gov.ph`、`maritim.bmkg.go.id`、`www.jma.go.jp` 各出现一次，fake-ip/blacklist 语义保持。配置读取阶段 DNS/GET0，不输出配置凭据。

生成文件移除三个新增过滤行后，整体字节哈希仍与旧文件不同；旧文件只留过哈希与 DNS 摘要，没有全文，**无法定位或归因额外差异，不能宣称生成文件只改了三行或其他设置完全相同**。选中扩展本身则与前轮获准三行增量完全一致。本次首次额外的全文件字节门禁因此退出1，记录在[首次核验](clash-applied-first-extra-byte-guard.json)；按用户本轮明确要求的“扩展/生成26、原23、新3各一”六项确认全部通过，整体字节差异单列限制，没有把初次结果改写为全绿，也没有放松后续网络安全入口。运行内核 API 未读取。

## 精确请求与响应

四个入口重新逐目标安全 DNS，所有返回地址均公网；实际连接固定到这批已校验地址，HTTPS 主机/SNI/正常证书验证保持。时间均 UTC。

| 目标 | 接收时间 | DNS / GET | HTTP / 字节 | 结果 |
| --- | --- | --- | --- | --- |
| PH-W01 `https://www.pagasa.dost.gov.ph/tropical-cyclone/severe-weather-bulletin` | 05:53:36.714Z | 1 / 1 | 403 / 118 | 错误页 `403 Forbidden`；不是官方天气空状态，无活动身份/时间/区域样本 |
| PH-W02 `https://www.pagasa.dost.gov.ph/weather/weather-advisory` | 05:53:36.848Z | 1 / 1 | 403 / 118 | 同类错误页；不重试，不推断 WAF/地区/UA 原因 |
| ID-W02 根 `https://maritim.bmkg.go.id/marine2026-data/` | 05:53:37.472Z | 1 / 1 | 200 / 577 | 目录索引18个锚点；没有数值港口记录或明确 apidoc 标识 |
| XX-W02 `https://www.jma.go.jp/bosai/typhoon/data/targetTc.json` | 05:53:37.778Z | 1 / 1 | 404 / 2203 | 官方404 HTML，不是 JSON/空列表，没有有效气旋对象 |

四个响应均完整留存本地 ignored `.tmp/r2-official-gaps-applied-20261015-private/*.response.bin`，逐一按字节核对大小与 SHA-256。[请求台账](request-ledger.json) / [DNS台账](dns-ledger.json) / [状态、错误message和hash](capture-summary.json)。四次响应均无 Location；没有重定向或额外请求。远端不发布完整 HTML、Cookie、凭据或响应头全集。

## 结构观察与条件分支

只使用已安装的 cheerio 对本次原件做最小离线 DOM 观察，过程不发请求，不新增产品 parser/provider。[结构记录](structure-observation.json)。

- PAGASA：两个错误页没有 PDF 链接，PDF 下载0。原10/10官方局部无活动状态保持其历史范围，不能写成今天的空状态或全国无风险；本次活动正样本仍缺。
- BMKG：原页真实链接包括 `doc/`、`help/`、`pelabuhan/`、`pelabuhan_slug/`。`doc/` 实际解析为 `https://maritim.bmkg.go.id/marine2026-data/doc/`，但原页没有文字/链接证明其为官方 apidoc；本轮条件不满足，未跟进，也未把目录备注 `/apidoc` 猜成请求。Jakarta/Tanjung Priok 官方 KODE、坐标/名称对应、字段/单位/时间仍未知；港口 JSON 请求0。根200不等于数值来源合格，目录“无需鉴权”保持，不要求密钥/付费。
- JMA：targetTc 404 后停止相关分支，forecast/specifications 各GET0，没有选中或拼接气旋标识、不复用旧 TC2634/2635、不枚举。历史 forecast 诊断保留，不能补上本次缺失的 specifications。

[条件决定](conditional-decisions.json)均 NOT_RUN。总预算最多7GET，实际4，剩余3不作重试或新产品授权。**成功响应1（仅目录根）、成功空0、HTTP错误3；业务记录0、持久化0。** 没有合格正样本/数值 JSON，现有产品解析/SQLite字段回放 NOT_RUN，避免对错误页/目录索引伪造记录。

## 当前状态与下一步

本轮资格等待父审，全部原资格/分母/阈值保持：**24/39、21/34，数值3/5**；整体R2和24h未通过。当前矩阵给四项登记本次真实响应与原阻断/历史响应引用，不用历史成功遮盖本次错误，不把根索引当港口数据，不直接升格或降格来源资格。

下一项建议按实际材料分别界定：BMKG 可由主会话明确批准已观察到的精确 `doc/` 一次文档核验，先确认产品身份/KODE出处；PAGASA 保留403待可审查的官方活动样本或新的有界诊断授权；JMA 需核实官方当前列表入口或取得真实列表样本，不猜替代路径。本轮不执行这些后续动作。

有界采集 harness 1项 raw exit0只表示程序完成；原输出/hash见[命令](capture-command-initial.json)，不算来源PASS。文档验证、Markdown lint、归档/原日志hash、正常提交钩子及真实 Neat Freak 单列。旧重复自动导入与固定 wrapper DEP0190提示保留。产品/目录/生产/迁移/阈值不改，完整产品 install/typecheck/lint/full Vitest/build、GUI/S7/24h本批 NOT_RUN；无付费/真实LLM/merge/deploy/force-push，全部现场保留。
