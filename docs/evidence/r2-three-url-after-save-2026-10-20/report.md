# 保存应用后的三URL有界验证（2026-10-20）

本地目录：D:\try one\Shipping HOT；分支codex/shipping-hot-r2；HEAD 40629587e22d8932df105962ec214530e4054414。07:51:35.830Z—07:51:37.012Z，仅使用已授权三URL各一次。请求前依据07:40只读快照：生成filter29、PPA/MOFCOM各1、原27完整；不再读取此前受拒的进程数据，不将运行核心路径另设为门禁。

| 来源 / URL | DNS / transport / 请求预算 | 结果 | 样本 |
| --- | --- | --- | --- |
| CN-T01 https://www.mofcom.gov.cn/zcfb/index.html | 1 / 1 / 1 | HTTP200，text/html，20318字节 | 完整HTML仅私有ignored目录；SHA256 ab5e3780d9988fe7032458a05ad00adf4f6e66bb891aaaed385f8e2f515d340f |
| PH-P01 https://www.ppa.com.ph/content/ppa-helpdesk-advisory | 1 / 1 / 1 | TLS阶段UNABLE_TO_VERIFY_LEAF_SIGNATURE；无HTTP响应 | 无body |
| PH-P01 https://www.ppa.com.ph/ppa-port-news | 1 / 1 / 1 | TLS阶段UNABLE_TO_VERIFY_LEAF_SIGNATURE；无HTTP响应 | 无body |

三次系统DNS均只返回经校验允许的公网地址（逐项见[账本](request-ledger.json)），本轮未触发同域受限地址停止。PPA两入口共享来源PH-P01，不计两行来源；其TLS校验失败不是HTTP状态、字段缺失或已解析内容。保留原TLS/CA/主机名验证，没有采用错误消息建议更换CA或启动参数。

每URL10秒/512KiB，0跳转跟随、0重试、0详情/附件；没有Maersk请求，没有完整响应header/cookie/token/rawPacket。全部原安全DNS全地址校验/pinning/TLS边界保持；Node全局header16384且不传源级override。原件位置见账本，仅在已有.tmp私有样本目录。raw exit0只表示诊断脚本完成，不将两次TLS失败写成成功。

本轮是访问验证：CN-T01的200尚未进行正文/字段/日期验收；不得据此改资格。机器matrix/目录及公开26/39、资讯24/34不变；数字证据仍为历史3项有限诊断＋新增1项完整原件离线解析（分母5）。未实现Maersk日期/collector切片，留下一轮审查。未改产品、来源配置、DB/Secret、服务/插件或网络；无生产启用、24h/R3、提交/推送/PR/merge/deploy。

后续最小项：CN-T01仅可在另行安排的离线原件字段核查后判断；PPA仍阻塞于现有Node严格TLS证书验证。不得自动重试、降级、换CA或绕过。先返回本轮结果。
