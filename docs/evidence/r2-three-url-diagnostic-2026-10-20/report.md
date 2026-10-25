# 三个既有目录URL的有界诊断（2026-10-20，待父审）

本机`D:\try one\Shipping HOT`，`codex/shipping-hot-r2@40629587e22d8932df105962ec214530e4054414`加保留未提交候选。本轮无产品代码/测试/依赖变更，不重跑已认可门禁；只补精确URL失败层证据，不新写抓取器或来源适配。

## 前置条件

Node24.15.0可用，前轮VN取证已完成raw exit0，无本轮自有在途旧任务；未停止其他既有进程。先核对3010个本地证据/私有capture JSON/HTML/bin（排除依赖、构建/clone快照与保留DB）。[预检](preflight.json)未发现这三个精确URL已有403/401、实际浏览器安全警告或足够原件。Maersk最新既有请求为2026-10-15T02:38:28.356Z的generic fetch_failed，无底层code/message；更早DNS阻断保留历史。PPA两精确目录产品无合格请求存档；目录旧CA说明不是实测证书或允许添加CA的凭证。

## 逐URL实际账本与阻塞层

| 目标 | 本轮系统DNS / GET尝试 | 结果与准确范围 |
| --- | --- | --- |
| `https://www.maersk.com/news`（XX-K01） | 1 / 1 | 04:18:45.500Z开始、04:18:46.098Z结束；安全链对公网地址调用原transport，真实`HPE_HEADER_OVERFLOW` / `Parse Error: Header overflow`，raw exit2。HTTP响应头解析器失败，未形成完整HTTP状态/Content-Type/HTML。 |
| `https://www.ppa.com.ph/content/ppa-helpdesk-advisory`（PH-P01） | 1 / 0 | 04:19:32.542Z开始、04:19:32.549Z结束；系统DNS返回198.18.0.79，原安全链`blocked_address`，raw exit2。在地址验证层停止，TLS/HTTP未发生，不证明目录原CA说法。 |
| `https://www.ppa.com.ph/ppa-port-news`（PH-P01） | 0 / 0 | **未请求**：同host已在刚发生的系统DNS/地址检查获得安全拒绝，停止而不重复DNS/换路。这里只复用host层停止依据，不声称该URL返回任何状态、证书或页面错误。 |

总上限3 GET、每URL最多1，实际仅1次transport/GET尝试、2次系统DNS、完整HTTP响应0。[请求账本](request-ledger.json) / [原诊断字段及分类](diagnostics.json)。每次仍10秒/512KiB、0重试/0自动跳转、0详情/图片/分页/登录/付费，系统DNS与`secureFetchArticle/defaultTransport`不变。GET尝试不代表取得了HTTP响应，PPA在transport之前即拒绝。

只记录脱敏code/message/phase、必要证书错误类型（均无已证证书错误）；不存错误rawPacket、完整响应头、进程命令行、凭据或secret。原Maersk临时state的phase是通用pre-response transport；根据实际HPE代码，本报告进一步明确HTTP响应头解析层，原诊断日志保留不重写。没有把该错误定性反爬，也不知道真实状态、实际header大小或触发原因。

## 可实施范围与最小下一步

- Maersk：没有成功HTML，无法给出已证selector/字段适配。当前原transport不提供本轮已批准的来源专属header上限调整，**本轮不提高限制或换工具重试**。若未来继续，先审查有界header资源策略及最小来源范围，再另批请求；header overflow本身不证明网页是JS壳、反爬或证书异常。
- PPA helpdesk：现证据只到DNS/地址验证，不能先配CA或编造TLS根因。当前无可适配HTML。需要未来另行授权范围内的合法公网解析证据才有继续条件，本轮不修改DNS/代理/CA或安全范围。
- PPA port-news：保留该具体产品未验证；不是以helpdesk的页面状态替代它。没有单产品成功，更不能把两个URL拆成两个来源或算PH-P01整行通过。

本轮没有成功HTML，故预期产品、标题/真实链接/原日期、JS壳、重复身份与字段完整性的实页核查均NOT_RUN，而不是空结果/PASS。无HTML原件产生，Git仅必要诊断元数据。机器矩阵/目录字节不改：26/39、资讯24/34保持，数字仍历史3项有限诊断＋新增1项完整原件离线解析，不能写4/5生产接入。

## 收尾

本轮只改本证据与status现役指针；[真实Neat Freak](closeout.md)、文档lint/链接/保护检查见[summary](summary.json)。所有未成功动作已确定停止，无未完成网络操作。源开关/库/Secret/服务/插件保持；CN-T01只等待用户应用反馈，未轮询。没有浏览器安装探测、24h/R3、commit/push/PR/merge/deploy或删除。
