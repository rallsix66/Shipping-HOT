# 单次六源公开核查结果 — 2026-10-13

基线 `9d7b39b68cc3e2bad9cd93e3ea7cc4829a046ed6`；父批准后于2026-10-13T04:10:15.298Z至04:10:15.314Z执行唯一一次批次。精确六URL来自已核目录，串行每源一次安全入口核查，未改目录状态/URL/生产开关/阈值或地址策略。

**批次结果 BLOCKED（本机DNS安全边界），不是六个上游站点已证实不可达。** `secureFetchArticle`原有检查 `addresses.find(isBlockedAddress)` 对六源均返回 `blocked_address`；这意味着DNS结果至少含一个禁用私网/保留地址，现有安全入口在调用transport前拒绝。没有进一步DNS重查、换解析器/网络出口、代理、CA修改或重试，也不猜实际地址/拦截原因。

| ID | 唯一目录URL | 结果 | HTTP状态/响应/解析 |
| --- | --- | --- | --- |
| MY-P02 | https://www.westportsholdings.com/category/press-release/feed/ | blocked_address | HTTP未发送；无响应；collector NOT_RUN |
| PH-M01 | https://portcalls.com/feed/ | blocked_address | HTTP未发送；无响应；collector NOT_RUN |
| MY-C01 | https://www.customs.gov.my/ms/arkib/pengumuman?format=feed&type=rss | blocked_address | HTTP未发送；无响应；collector NOT_RUN |
| MY-T01 | https://www.mof.gov.my/portal/ms/berita/siaran-media?format=feed&type=rss | blocked_address | HTTP未发送；无响应；collector NOT_RUN |
| TH-W01 | https://www.tmd.go.th/en/api/xml/CAP | blocked_address | HTTP未发送；无响应；collector NOT_RUN |
| ID-W01 | https://www.bmkg.go.id/alerts/nowcast/en/rss.xml | blocked_address | HTTP未发送；无响应；collector NOT_RUN |

实际HTTP transport调用0（上限6），未得到任何HTTP状态码/响应字节/原始hash。逐源时间及null响应字段见batch-results.json；无标题/链接/日期结果可造。实现的请求计数是pinned transport调用预算，不等价于服务器收到GET的计数；本次0意味着该transport从未被调用。

- 当前真实解析新增：**0/4新增候选**；TMD/BMKG基准也未完成端点验证。
- 本次可复现原结构响应证据：**0**；元数据衍生证据也0。没有parse后重造RSS或自证回放，没有新响应可保存。未证明任何XML/编码/时间解析或R2-5通过。
- 旧TMD/BMKG/NCHMF三份存档子检查仍是历史独立证据，不归到本次。41自动总清单和未决最终R2文章分母/覆盖率保持；本批次不批准任何豁免，也不重分类目录OK状态。
- 零重试、详情、重定向跟随、登录、凭据、付费、LLM、Runtime/调度、24h或保留库操作。下一次网络动作需父另行决定，未自动利用剩余请求预算开启第二批。

## 脚本与证据边界

临时probe通过现有secureFetchArticle进行真实安全入口核查，调用既有pinned Node transport之前有精确URL/每源一次/总六预算/512KiB/10秒/信号/不增CA检查；maxRedirects=0。单源和总120秒取消边界；Promise.race防止DNS等待突破单源时间，迟到路径的已取消transport守卫禁止后续发送。

若有响应，当前collector只能用同一原始字节在内存SQLite离线解析（不再发第二次网络请求），metadata_only限制正文；不把元数据重造RSS当原结构证据。可保存原字节的条件仅限TH-W01当次XML明确public domain且敏感内容检查通过，其余源许可未明确只允许元数据衍生。由于本次无响应，两种分支均NOT_RUN，不能声称验证过它们或已留任何原站夹具。

guards.log：离线2 tests PASS exit0，验证二次/替代URL、取消、放宽大小/timeout、额外CA均无法到达真实transport。batch.log：一次批次边界测试1 PASS exit0，证明六结果与请求<=6约束；**测试PASS不是来源抓取PASS**。保存当前基线完整SHA、命令、UTF-8 stdout/stderr/raw exit及可复现临时probe文本。没有自动可再次执行的调度入口；不要因存在保存脚本自行重跑live模式。

Pending：解决本机DNS/出口安全条件的单独诊断或用户选择（尚未授权/执行）、另次精确URL核查授权；六源实际HTTP/真实collector解析/许可和原结构夹具资格。R2整体未完成。本轮无产品代码变更，必要脚本/证据检查与实际Neat Freak收尾即可，不机械重跑全部产品gate。
