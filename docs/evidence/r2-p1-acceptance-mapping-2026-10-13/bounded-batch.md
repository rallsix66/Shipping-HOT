# 单次有界批次准备（待父确认；未执行）

目录固定六ID和精确URL，没有猜/feed新路径或切换站点。MY-P02/PH-M01/MY-C01/MY-T01均在当前目录明确为P1 rss；TMD/BMKG亦是P1 rss，仅端点基准。各原目录状态是历史核查，不代表本轮可达。

| ID | 唯一请求URL | 唯一host白名单 | 用途 | 目录原状态 |
| --- | --- | --- | --- | --- |
| MY-P02 | https://www.westportsholdings.com/category/press-release/feed/ | www.westportsholdings.com | new candidate coverage | OK (28/09/2026) |
| PH-M01 | https://portcalls.com/feed/ | portcalls.com | new candidate coverage | OK (30/09/2026) |
| MY-C01 | https://www.customs.gov.my/ms/arkib/pengumuman?format=feed&type=rss | www.customs.gov.my | new candidate coverage | OK (28/09/2026) |
| MY-T01 | https://www.mof.gov.my/portal/ms/berita/siaran-media?format=feed&type=rss | www.mof.gov.my | new candidate coverage | OK (29/09/2026) |
| TH-W01 | https://www.tmd.go.th/en/api/xml/CAP | www.tmd.go.th | endpoint baseline; no new unique archive source | OK (30/09/2026) |
| ID-W01 | https://www.bmkg.go.id/alerts/nowcast/en/rss.xml | www.bmkg.go.id | endpoint baseline; no new unique archive source | OK (WebFetch) |

## 请求和安全边界

- 仅当前Windows实际出口，按表顺序串行，一源一次无凭据索引GET；最多6个HTTP请求。0重试/0调度/0详情/0重定向跟随，任意3xx记录后该源结束；失败不换URL/出口，也不补请求。仅DNS解析不计HTTP请求，但仍使用已有public-IP过滤和地址固定，域名不扩。不会启动Runtime。
- 使用已有secureFetchArticle安全检查与pinned Node transport；单源明确maxRedirects=0（现有可注入请求参数的收紧，不改生产默认）、maxBytes=512*1024（解码前）、timeoutMs=10000，总批次墙钟上限120秒（AbortController终止，不产生补请求）。原Intel collector默认是512KiB/10秒；旧盘点建议中的2MiB来自既有Feed列表上限，本提案纠正该混用，**不放宽intel默认**。不使用库默认fetch或跟随重定向，不TLS bypass、不新增CA/host/headers/cookies/API key。
- Accept/允许类型只用已有RSS/XML类型：application/rss+xml、application/atom+xml、application/rdf+xml、application/xml、text/xml；非XML/登录/挑战页面不当作成功列表。响应正文空、非法XML、无非空title/link/真实发布时间分别记录失败/partial，时间缺失不以抓取时刻补值；302不自动改目录URL。
- 来源归属与版权不同：目录批准接入候选，不授第三方正文再发布权。四个新RSS没有已记录full-text许可，**只允许标题/URL/发布时间元数据**；TMD旧RSS声明public domain，BMKG需注明来源且商业许可仍有限制。整批不保存description/content:encoded/正文、不抓文章；任何未来excerpt/full存储另行核许可。
- 原响应只在内存解析、hash/字节计量，原wire全文和响应头不落盘/不提交。仅保留脱敏公共元数据、status/content-type、原始编码选择/冲突、sha256/时间及可回放的最小RSS元数据衍生片；明确标记衍生而非逐字节原响应。cookie/authorization/key值及带凭据URL不记录；仅必要头字段白名单，无原始headers dump。原始完整RSS存档若确需R2-5完整谱系须另批许可和保管，不默认授权。
- 不操作保留库；如做采集器回放只用新内存/隔离库，测试seed为局部配置且元数据许可，不注册/启用来源。没有LLM、embedding、付费、browser/JS、24h或历史封港任务。全部status=NOT_RUN。

## 预期新增覆盖和确认项

若四个新RSS均可达/安全/元数据三字段合格并能在当前collector离线回放，最多增加4个独立真实存档候选：历史三源子检查从3项到最多7项，**只是个数展望，不发布分母/百分比或R2-4/5PASS承诺**。TMD/BMKG重复基准不新增ID，可补精确目录端点与最新字节谱系；旧BMKG/en成功不证明/rss.xml。

父确认前须明确：上述唯一6URL/当前Windows出口/最大6次请求与120秒边界；仅metadata和脱敏衍生夹具的保存许可；先批准各域验收映射再定义最终R2文章分母。遇限流/403/redirect/证书/超限，按原事实返回，不自动CA修复、换域名、改目录或扩大预算。批准后才实施一次批次并交原始日志审查。本文件准备不构成已发请求或授权。
