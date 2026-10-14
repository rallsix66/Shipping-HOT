# 六源有界公开观察 — 2026-10-14

本批 07:16:47–07:16:51 UTC，目录 URL 均未修改。六源各评估一次，其中四源 DNS 安全检查返回 blocked_address，未发送 HTTP；Northport、泰国海关各一次 GET，合计 **2 个 transport/HTTP 请求**。无重试、重定向、详情、换路、网络设置、付费、LLM、生产启用或 24h。512KiB/10s/总120s/并发1；实际响应均在限额内。DNS 地址未在本批单独存档，不推断是哪一段地址或长期可用性。

| 源 | HTTP 请求 | 结论 | 结构材料及缺口 |
| --- | ---: | --- | --- |
| CN-P01 广东海事 | 0 | BLOCKED | blocked_address，无响应，解析 NOT_RUN |
| CN-T02 财政部税政 | 0 | BLOCKED | blocked_address，无响应，解析 NOT_RUN |
| VN-P01 越南航海 | 0 | BLOCKED | blocked_address，无响应，解析 NOT_RUN |
| PH-C01 菲律宾海关 | 0 | BLOCKED | blocked_address，无响应，解析 NOT_RUN |
| MY-P03 Northport | 1 | PARTIAL | 200 text/html，73037 bytes；107 anchors，85 局部日期容器观察；保存原顺序前六 article 容器的日期/标题片段/链接关系和标签树。未运行产品适配器，历史关联 FAIL 未改为 PASS。 |
| TH-C01 泰国海关 | 1 | PARTIAL | 200 text/html UTF-8，123781 bytes；230 anchors、101 tr；前六 tr 同行日期/标题片段/链接关系及标签树。泰文月份/佛历如 13 ตุลาคม 2569 仅原文观察，未转公历或声明发布时间。 |

原始响应在 transport 返回后、解码/结构处理前立即写入 `.tmp/r2-six-public-2026-10-14-private/*.response.bin`，并落盘 response 元数据。抓取原始字节哈希与提交派生材料哈希分开记录。原始字节仅本地忽略目录，用于此授权核查；再分发许可未确认，不提交完整 HTML、cookie/header、脚本/key/input值。提交标签树只保存标签层级和非敏感属性名，日期关联样本最多六组、标题最多120字符，无正文。没有可提交原始页面夹具，R2-5 完整原字节回放缺口保留。可复现性：本机原字节可按哈希验证并离线重生成，远端仅可核验派生材料和步骤，不能假称远端完整原页面回放。

首次 `*-structure.json` 启发观察删除 form 子树，导致 Thai anchors=0；该计数是观察器缺陷，不是网页无条目。原记录保留；后续离线步骤 `*-dom-shape.json` 保留 form 后代、排除 input 值，纠正为230 anchors/101 rows，并记录泰文原日期。Northport 首次候选为导航大容器、日期关联模糊；离线步骤改为局部日期叶节点向上观察，保留 article 内关联事实，未据此挑选或合并冲突条目、也未计 PASS。两步仅取证，不改产品算法/适配器/日期规则。

敏感扫描在派生材料上有 synthetic 阳性对照，检测成功；提交材料实际值命中0。未打印秘密。该检查不代表历史全库安全审计；本地未知许可原页可能含第三方脚本/标识，未承诺清除所有值，不再分发，不删除旧残留。程序和源级结果、原始命令/退出码均保存。

下一最小工作（待交审下令，不在本批实现）：Northport article 内独立标题节点/链接/日期的精确选择器及现有 fail-closed 冲突回放；Thai tr 内 td 日期、标题锚点和 detail 链接配置，泰文月份及佛历边界仍需明确规则与离线回放；四个 blocked_address 先保留阻塞，不换 DNS/出口或追加请求。39 项公开分母/至少32通过不变；本批新增 PASS=0，不宣称达到全 P1 阈值。

验证边界：此次一条取证 harness 退出0，只证明批次边界断言通过，不是六个源可用性 PASS。离线结构脚本退出0，无追加 HTTP。产品代码/迁移/开关/目录未改，既有 e5d2f0b 门禁不重跑；GUI/S7 NOT_RUN。Closeout 应核对状态文档、证据及 git 状态，真实 inventory 仅盘点，不当安全审计；不清理本地原始材料或其他残留。

真实 Neat Freak inventory 已执行，raw exit0，日志已保存；本批20份 JSON 元数据敏感值模式检查阳性对照有效、实际命中0。文档 lint exit0、git diff --check exit0。六事实状态：代码未改且沿用已验证 SHA；本批运行只读观察已留证／生产启用未运行；状态文档已更新；规则与架构未变且一致；memory 未写／不在本轮范围；workspace 原始材料和旧残留保留，不清理。独立父复审待完成，整体R2未通过。
