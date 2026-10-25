# R2 下一四目录来源有界核验 — 2026-10-14

Westports修正先单独提交为 `e4d56116cda05fe4a8dbe151040c26874b6807c1`：保存RSS三条日期分别2024-11-08、2025-02-01、2025-08-01，最新仅2025-08-01，依目录既有口径改STALE，不计R2-4 OK；未重抓。产品代码仍为 `355bc861d4020ba22ddd00401de709d7cee497e3`。

随后在上述HEAD执行父会话授权的四个精确目录URL。10:55:51 UTC每源一次系统DNS（Node OS lookup），立即保存地址与分类，再交现有secureFetchArticle安全检查。四项都返回198.18特殊地址，安全检查阻断在transport之前，**系统DNS4次 / HTTP0**，没有响应原字节。没有猜selector/日期、增加候选配置或合成替代真实页面。

| 来源 | 精确目录URL | 系统DNS地址 | 当前环境结果 | HTTP / 字段回放 |
| --- | --- | --- | --- | --- |
| CN-P02 | https://www.sz.msa.gov.cn/ | 198.18.0.166 | BLOCKED / blocked_address | 0 / NOT_RUN |
| VN-D01 | https://phongchongthientai.mard.gov.vn/Pages/Trang-chu.aspx | 198.18.0.167 | BLOCKED / blocked_address | 0 / NOT_RUN |
| MY-L01 | https://www.pos.com.my/service-update | 198.18.0.168 | BLOCKED / blocked_address | 0 / NOT_RUN |
| ID-T02 | https://jdih.kemenkeu.go.id/ | 198.18.0.169 | BLOCKED / blocked_address | 0 / NOT_RUN |

这只说明当前运行环境不能取得页面，不证明来源内容失败。地址记录直接支持198.18特殊范围阻断，不推断运营影响。没有DNS覆盖、公共resolver切换、代理/TUN/fake-IP例外修改、重试、跳转跟随、迁域、分页、详情、CA或额外请求。原字节仅在取得响应时保存在ignored本地目录；本次没有响应，因此没有原页夹具可供配置或离线入库/重复/只读重开验证，这些项均NOT_RUN。

[一次性DNS台账](dns-ledger.json)、[HTTP台账](request-ledger.json)、[逐源结果](summary.json)、[启动授权/HEAD](launch.json)、[命令和退出码](command.json)、[stdout](stdout.log)、[stderr](stderr.log)、[采集过程](capture-procedure.ts.txt)。采集边界harness退出0只证明一次性计数和结果留存断言通过，不是来源解析成功、产品门禁或R2验收通过。

完整stdout/stderr字符串及原stdout字节hash保留在command.json；stdout.log展示副本只去掉末尾空行以通过仓库空白检查，原本地日志另留`.tmp/r2-new-four-stdout-original.log`。不是删除失败或改写采集结果。

当前累计：[41项机器矩阵](../r2-current-source-matrix-2026-10-14/mapping.json) / [完整报告](../r2-current-source-matrix-2026-10-14/report.md)。R2-4 **19/39（48.72%，距32差13）**；19 OK、8 PARTIAL、1 STALE、4 BLOCKED、7 NOT_RUN。R2-5 **11/34**与独立数值有限诊断 **3/5**范围不变，整体R2未通过。

源码、依赖、schema、生产允许列表、默认开关和网络设置无修改；因此不跑干净SHA产品门禁。本次文档/证据lint、台账/摘要核验及真实Neat Freak收尾另留记录。许可未知原页不远端再分发；本次只有地址、状态和过程，不含上游正文、cookie/key。生产启用/24小时/LLM/付费/GUI/S7未运行，不合并部署，不强推。
