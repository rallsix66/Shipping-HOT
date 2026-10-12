# CN-W01/CN-W02 NMC 有限接入证据（代码 a6c00bc70de78a0e4d0a129947f69c8878445aa0）

## 门禁（docs/evidence/gate-a6c00bc/，2026-10-11 09:36–09:38 UTC+8，提交后工作区干净）
install --frozen-lockfile / build / typecheck / lint / vitest（95 files，771 passed / 3 skipped）/ smoke:p0-native / S7（PASS）均 exit 0。

三类检查分开记录：
- 自写扫描（git diff 76b39fc..a6c00bc 新增行）：类密钥正则 0 命中；32 位十六进制行 14 处，脚本按规则计为 exit 1（CMS 路径排除规则只覆盖了 `/publish/cms/view/` 形式）。
- 人工复核：这 14 处均为站点公开 ID——`/publish/cms/(view/)<id>` 页面链接、`category-icon/black/<id>` 图标名、`bszs.conac.cn` 政府网站标识 id、页面脚本中的 `categoryid` 与 `/rest/relevant/<id>`（本实现不调用）。不是密钥，未脱敏。
- 盘点脚本 `scripts/audit-inventory.sh`：exit 0（只是目录/规则/Git/Markdown 盘点，不是密钥扫描或安全审计），输出 `gate-a6c00bc/audit-inventory.log`。

## 固定样本测试（与真实运行分开）
`server/providers/nmc-warning.test.ts` 16/16：抓取边界、重定向失败、执行节点剥离、结构缺失、历史产品提示、多台风对象、正文偶含发布/解除、未变重抓、同身份修订、新期号、缺身份、默认关闭、runtime→SQLite 的成功/部分失败/首次全失败/已有记录后全失败。

## 真实运行（隔离库，2026-10-11 09:38 UTC+8，@ a6c00bc 干净工作区）
6 次 GET 全部 200、无重定向；收到 6/6，新建 6，失败 0；历史产品提示 4、解除主句 4；关联港口 0、eventEligibility 0、上海港 WR-O01/O02 命中 0；job success。台风公报此次为 10 时新一期（新记录）。`nmc-live-evidence.json`，raw 经类密钥脱敏规则处理后 0 命中。

## 展示核验
生产构建 + API + 本地 Chrome 打开本项目 /feed：PASS 19/19（`nmc-display-evidence.json`，截图 `feed-nmc.png`）。可核对原始发布时间、历史产品提示、解除主句、原文等级未映射、关联港口 0。无头浏览器只用于打开本项目页面，未用于抓上游。

运行条件：`SHIPPING_RUNTIME_ENABLED=false`、`SHIPPING_DATA_MODE=real`、各 provider 为 mock、`SHIPPING_WEATHER_ALERT_PROVIDER` 未设、provider 密钥环境变量已删除，cwd 为隔离运行目录。GET 前后核对的计数与指纹未变：feed_items 6 行及 id:长度 指纹、provider_usage 0 行 / 0 次请求（runtime_job_runs 表在该库不存在，记为 -1）。这只说明这些被核对的计数和指纹没变，**不能证明**没有任何网络或 LLM 调用。（display 脚本里该检查项名为 `get_no_side_effects`，名称偏宽，以本段为准。）

台风公报原始时间按原文保留为“10 时”一期，时区仍为未确认，不做换算或更正。

## 限制
只覆盖 6 个国家级页面，每栏只能看到最新一条；不含省市预警信号；时区/有效期未知；未重跑八港天气。
