# R2-8 最小24h观察提案（未授权、未启动）

> 交付更新（2026-10-21）：已普通推送到 `codex/shipping-hot-r2`。Maersk/商务部/日期切片 `3f8971e3`，门禁 `1b68adcd`。观察工具 + BMKG(ID-W02) 切片 `c9af8c55`，门禁 `5e665216`，包含 LOGONSERVER 仅 win32 隔离前认可。worker 启动竞态 `160c67a9`，门禁 `00e97518`。以上均经 dots 限定复审通过。下文“未提交/uncommitted/待父审”是当时的口径。正预算实网观察、24h、R3 仍未运行、未授权；S7、R2 均未通过。

> 2026-10-20 update: the launcher/request cap and Windows environment repair have received limited offline parent acceptance, still uncommitted. The earlier unimplemented wording below is historical. See [offline implementation](../r2-observation-launcher-offline-2026-10-19/report.md), [environment repair](../r2-observation-env-repair-2026-10-19/report.md) and [current R2 closeout](../r2-closeout-offline-2026-10-20/report.md). No positive-budget source call or 24h run has started; this proposal still needs separate authorization.

这只是用户决定前的文档方案。没有创建runner/运行目录、写配置、启用Runtime或访问来源。**两源成功也只是2/39的观察，不能替代原R2-8全P1连续24h要求或改变25/39、24/34。** 当前生产允许选择仅以下既有产品：

| catalog/internal ID | 精确现有URL | 已有持久许可 |
| --- | --- | --- |
| TH-W01 / intel:th-w01 | https://www.tmd.go.th/en/api/xml/CAP | full（既有public-domain Feed证据）；不是全站正文许可 |
| ID-W01 / intel:id-w01 | https://www.bmkg.go.id/alerts/nowcast/en/rss.xml | excerpt_only；不能存完整受限正文 |

## 复用入口与隔离

- 在未来批准的全新进程/目录`<repo>/.tmp/r2-24h-pilot-<approved-run-id>/`运行，SQLite为该cwd下`.data/shipping-hot-v3.sqlite3`。启动前验证最终绝对路径在repo/.tmp内且不是任何保留库；db0实际连接和ownership lease必须指向同一隔离文件。此路径只是提案，未创建。不能依赖SHIPPING_DATABASE_PATH覆盖dev/start，也不运行仓库根pnpm dev/start。
- 只用现有productionIntelOptions、createIntelCollectJob和bootstrapBackgroundRuntime({jobs:[intelJob]})的显式jobs能力；单一BackgroundRuntime且只注册intel-collect。**不得直接启动默认完整registry**，因为其中含翻译/其他Provider jobs，选择两个intel ID并不自动隔离其他jobs。没有第二调度器、cron、系统服务或新数据库结构。单次验收外层只负责配置/生命周期/ledger，未实现，必须先审查后才可开始。
- 当前开关默认off；若获批，仅该子进程显式选择TH-W01/ID-W01、real模式及enable，不写持久化配置，不扩展生产允许列表。保留库/SecretStore不挂载、不复制，环境仅保留运行必需项并剔除全部Provider凭据；不注册翻译/paid业务caller，隔离预算0/未配，无付费fallback。

## 频率与请求预算建议

沿用当前productionIntelOptions的15分钟job tick与每源adaptive min15/max60分钟，公式不改：完整过去7个UTC日的新自动发现数/7，低于等于0.15条/日取60，否则round(clamp(1440/(perDay*3),15,60))；初次导入和manual排除，非修订数。新库首轮后通常60分钟，每源约24个尝试；严格窗口[T0,T0+24h)且无manual runNow时，每源理论最多96个due尝试，两源192。失败仍用15min×2^(failures-1)，最大24h，source进入failing；不人为制造上游失败。

这不是物理GET硬上限：现有secure fetch可在允许host/HTTPS规则内处理至多3跳。建议授权物理GET硬上限200，DNS/HTTP/redirect独立ledger计数；未审核Location或达到上限就停止并保留证据，不能让重试/重定向绕过预算。现有collector没有单次试跑的总请求预算及未审核Location停止开关，所以**这些保障目前未声称已实现**；未来外层应只包装现有lookup/defaultTransport的观测/限额与停止，不复制fetch或parser。启动器尚需主审，不能直接把提案当可执行24h能力。若用户只批准无跳转精确产品，一旦30x就停止待审核，不能自动扩大URL。

## 零付费、结果与退出

- 仅已存许可blocks入隔离intel表；不抓详情/分页/隐含接口、不执行脚本、不调用LLM/预算测试。完整响应原字节原则上只在内存解析，ledger保留status/bytes/wire hash/时间和最小字段；完整raw归档若另需，须先明确本地保留许可/空间上限，远端不发布受限全文。
- start/end记录固定代码SHA、源配置manifest/hash、实际DB/cwd、UTC时间/持续时间/退出状态。这个外部manifest是本次运行配置凭证，不把现有source表或材料读取响应声称为完整历史配置快照。逐run记录items seen/new/revised、source状态/nextSyncAt/失败退避及独立DNS/HTTP次数。
- paid_receipt/attempt、翻译cache与付费Provider usage/token/费用增量必须0；intel_collect的免费同步usage可变化，其request_count是能力同步次数，不能拿它当HTTP次数。正常无新内容/ok_empty不推断全国气象安全或完整风险覆盖。
- 独立系统时钟连续观察24h，不用假钟/手工补跑/重启多段相加冒充；睡眠/断网/时钟异常/中断应如实标失败或不完整。安全地址拒绝、越界或未审核跳转停止，不改Clash/DNS/CA，不换工具绕过。普通HTTP失败按既有退避观察；若无真实失败，退避实网结果标“未出现”，只引用已有确定性反例测试。
- 结束复用shutdownBackgroundRuntime：stop→drain→job.end→release ownership。drain失败保留lock/未完成证据，**不按年龄/PID删锁**，也不清理保留库。对隔离库query-only重开验持久状态，并比对根保留3DB+Secret文件hash。
- 若实际获批执行，结果按原计划写入docs/live-verification.md的新R2节，保留旧P7历史，不修改成全能力通过。当前没有运行结果，不向该文件填造24h记录。

## 必须另行明确的授权

具体两源/精确URL及审核跳转、24h时间窗、现有15–60分钟频率、GET上限/停止规则、隔离DB路径/真实网络、许可存储与零付费；以及先审单次验收启动器。正式覆盖全部39个公开源另需完成来源配置/字段资格与扩大允许选择的授权。生产服务、保留数据库、凭据、网络设置、付费、merge/deploy始终不在此提案内。本轮不启动任何一项。
