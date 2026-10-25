# ONE目录URL与默认关闭候选落地 — 2026-10-15

本轮按批准将XX-K02目录URL由 `https://www.one-line.com/en/news` 改为已核实的 `https://www.one-line.com/en/newsroom`，并把已验配置放入现有候选数组。**来源DNS/HTTP均0，Maersk请求0，没有新的连通性或连续可用性证明。** 代码/配置提交为 `bebe1441465adfcabb9daf93cb2a8656ec1fc796`，后续证据文档提交独立。

## 已应用的目录变更与含义

[应用记录](catalogue-change-applied.json)与[单行表格差异](catalogue-change-applied.diff.txt)保存旧/新URL、前后目录LF hash和代码SHA。表格只有XX-K02的URL字段改变，所有其他ID/URL/格式/优先级保留；另增加来源链和格式映射说明。原URL实际308及Location `/en/newsroom` 保留在[原响应](../r2-carrier-reapplied-2026-10-15/XX-K02-response.json)，同主机目标200/原页字段依据仍是[此前限定实测](../r2-one-newsroom-target-2026-10-15/report.md)。没有重写旧提案或抓取记录。

| 目录/配置概念 | 当前值 | 含义 |
| --- | --- | --- |
| 目录ID / URL | XX-K02 / `https://www.one-line.com/en/newsroom` | 同源同新闻产品，旧URL/308链可追溯 |
| 目录方式 | `web_list` | HTTP响应为HTML新闻页面，不是一个新JSON接口 |
| 具体解析器 | `json_list` + `htmlScriptSelector` | 只读HTML内惰性 `application/json`，不执行脚本或取接口 |
| 数据路径 | `props.pageProps.pinArticle` + `props.pageProps.articles` | 原置顶1条与列表9条，映射及日期basis与已验配置相同 |
| 默认状态 / 许可 | `enabled=false` / `persistence=disallowed` | metadata_only，未扩大正文存储/重分发权限 |

配置位于 `server/intel/sources/html-index-candidates.ts`。现有页面候选共11项：原10个 `web_list` mapper，加ONE的HTML输入 `json_list` mapper；全部默认关闭。活动 `intelSourceSeeds` 仍只有原TMD/BMKG两项，生产允许选择、默认Intel job开关不变。添加关闭候选不等于接入生产开关，未新增主机、Provider、迁移、取数范围或网络配置。

目录一致性测试现在逐ID读取唯一表格行，精确比较URL和页面形态；不能用历史注释中出现旧URL蒙混匹配。ONE单独校验parser与HTML模式、许可、主机及已验证配置完全相同（仅显示名称改为ONE Newsroom），其余10项仍必须为原web_list配置。来源日期规则没有改变，源releaseDate无时区时仍保留秒精度/UTC null。

## 既有原页回归与干净门禁

使用本地同一635664字节原HTML，wire SHA-256 `682943942c38c8aebcbc68ec3888ca65e9278ed27a38d30a11134d283d893fe0`；不是新下载或从元数据拼造。[正式候选回放](../r2-one-catalog-candidate-replay-2026-10-15/summary.json)从真实候选数组读取配置，经原collector/SQLite首次10 items/10 versions，重复0新0修订、lastSeenAt正常推进；只读重开十条完整title/原aliasURL/dateEvidence对原JSON0差异，metadata-only标题块10个，数据库字节hash不变。与此前十条原字段派生逐项完全相同。

测试范围TCP与全局fetch守卫均0尝试；两次注入lookup/transport只返回测试地址与已有原字节，不是真实DNS/GET。未知许可原HTML/完整JSON仍只本地ignored，不入仓库，不输出Cookie或凭据。

代码bebe144全新隔离clone、Node24.15.0/ABI137、无旧node_modules，正常scripts的frozen install、build/typecheck/lint、17文件245定向、129文件1230全量通过/3既有Windows跳过、3个隔离smoke，九命令raw exit0。[门禁](../gate-bebe144-one-catalog-candidate/summary.json) / [源码核对](../gate-bebe144-one-catalog-candidate/source-proof.json)。测试源码diff0，根保留DB/secret-file摘要不变；依赖安装联网与新闻来源请求分开。GUI/S7 NOT_RUN，无UI/路由变化，原GUI待验限制不改。

## 当前矩阵与下一批建议

[矩阵差异](matrix-delta.json)确认除ONE目录/候选状态与本轮回归证据外，其他40来源逐项不变，全部覆盖计数和状态分布不变：**21/39、13/34，有限历史数值诊断另列3/5**。ONE最新实网时间仍是此前02:56 UTC；本轮没有刷新它，不能称持续可用。整体R2未通过，24h NOT_RUN；Maersk旧通用失败底层原因仍未知。

下一批仅建议以下三项，[机器清单与原始证据选择器](next-batch-recommendations.json)均基于已存矩阵，不发探测，不重做Northport冲突、VN-P01无日期、MY-L01缺详情链接的既有检索，也不扩展此前未跟随的跳转。

| 建议 | 既有可复用证据 | 主要缺口 / 可复用链 |
| --- | --- | --- |
| MY-C01 马来西亚海关RSS | 2026-10-13 07:00 UTC原目录200，7619字节；10条/10条标题链接时间齐全的派生记录 | 未保留完整原XML；复用Feed parser、安全字节抓取/解码、collector与metadata SQLite版本，补原XML→幂等→只读重开 |
| MY-T01 马来西亚财政部RSS | 同批07:00 UTC原目录200，6086字节；6条/6条完整派生 | 同上；需核对新取得的原始日期/时区声明，不从归一化日期反推原声明 |
| PH-M01 PortCalls RSS | 同批07:00 UTC原目录200，10112字节；10条/10条完整派生 | 同上；未知许可正文不重分发，原XML仅私有取证，不能把导出metadata当原XML |

三者已是R2-4 OK，所以即使下一轮全部合格，也只可能把R2-5从13/34补到16/34，**不会增加公开可用性21/39，公开缺口11仍在**。既有RSS结构、完整派生字段和同一解析链使其比未定产品或已确认结构冲突的来源更有把握；这不是成功保证。下一轮仍需主会话单独安排有界取证，先安全DNS、各精确URL最多一次GET，失败独立留证，不通过此建议自动请求或激活。

本轮无生产/24h、付费/LLM、merge/deploy/force-push；全部旧日志、原字节、库、clone和预览保留。实际Neat Freak见[closeout](closeout.md)，[当前矩阵](../r2-current-source-matrix-2026-10-14/mapping.json)和[交接](../../handoffs/r2-next-execution-2026-10-15.md)已同步。
