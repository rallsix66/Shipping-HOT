# JMA同URL证据归属修正与BMKG doc单次取证

执行起点 `32c8974c6c5f50ad8630b6eb771f0a6af3bd9b44`，产品仍 `bebe1441465adfcabb9daf93cb2a8656ec1fc796`。本轮新来源请求仅 **BMKG DNS1 / GET1**；JMA、PAGASA均0。没有系统设置写入、重试、跳转、链接遍历、PDF/图片下载、港口JSON或替代URL探测。

## 修正JMA404的产品归属与当前可用性

上轮把2026-10-15T05:53:37.778Z的404只关联XX-W02，遗漏了**完全同URL的XX-W01目录产品**，导致其latestActualFetch仍是10/10历史200，并继续计入当前可用性。这个归属和计数错误现已修正。

同一次实际请求 `https://www.jma.go.jp/bosai/typhoon/data/targetTc.json` 同时是：

- XX-W01的精确目录产品URL，与既有 `JMA_TARGET_TC_URL` 常量完全一致。
- XX-W02 forecast/specifications的前置气旋列表；404使其无法选择真实对象，本轮仍不请求两产品。

[交叉归属记录](jma-cross-product-attribution.json)绑定原[捕获](../r2-official-gaps-applied-2026-10-15/XX-W02-targetTc-capture.json)及[单次请求台账](../r2-official-gaps-applied-2026-10-15/request-ledger.json)。**没有新JMA请求，也不把一请求计成两次。** 原404、2203字节/hash、原请求ID保持；404不是无气旋/成功空列表，不猜新的入口或复用旧TC编号。

按用户要求的当前最新实测可用性，XX-W01 **OK→BLOCKED（HTTP404）**、countedOK=false；XX-W02维持PARTIAL。R2-4重算为 **23/39（58.97%，至少32、差9）**：23 OK / 8 PARTIAL / 1 STALE / 2 BLOCKED / 5 NOT_RUN。R2-5 **21/34**不变。数值 **3/5**保留原10/10有限历史归一化诊断，不当作今天接口可用性或原始JSON回放；旧200/数值证据和本次404均保留。信源目录原盘点状态不改，当前判定以机器矩阵为准。

## BMKG真实doc链接单请求

授权目标取自上轮根响应实际锚点 `doc/`，不是按`/apidoc`备注猜URL。本轮 **2026-10-15T06:05:16.385Z–06:05:16.817Z** 对 `https://maritim.bmkg.go.id/marine2026-data/doc/` 安全DNS1（全部公网）/GET1，既有安全入口固定已校验IP、正常HTTPS主机/TLS证书校验，HTTP **200 text/html; charset=utf-8、1137字节**，无Location。

完整原字节只保存在本地ignored `.tmp/r2-bmkg-doc-jma-attribution-20261015-private/ID-W02-doc.response.bin`，SHA-256 `1ac1835765cc2354cfed278a191bd229f9f23df452eb7b69de1d3398b46b9aaf`。[请求](request-ledger.json) / [DNS](dns-ledger.json) / [状态与错误字段](ID-W02-doc-capture.json)。远端只保存必要脱敏元数据/hash，不发布完整HTML、Cookie、凭据或响应头全集。

用既有cheerio离线观察：[结构/真实链接](document-observation.json)。它是文件目录索引，没有标题或h1/h2/h3；16个锚点为 **7 PDF / 7 PNG / 2子目录**，子目录为原页 `buletin/` 与 `cuaca/`。文件名包含降雨/沿海洪水/海浪等线索，但未读取文件内容，因此不据此认定产品正文、时效或API合同。**页面未见apidoc、Tanjung、Priok、Jakarta、KODE字样或官方港口映射**；未确认它是API文档，Jakarta/Tanjung Priok官方KODE及名称/坐标对应仍未知。所有实际链接只记录，未下载、未遍历。

ID-W02资格不变，根与doc目录可读不等于具体港口数值产品合格。新业务记录/入库0；没有合格港口JSON，产品数值解析/SQLite回放NOT_RUN。目录“无需鉴权”保持，未引入密钥、付费或新Provider。

## 收尾与下一步

仅更新XX-W01、XX-W02交叉归属和ID-W02本次材料，其他38项来源条目原样；全41项R2-5、数值诊断、许可、默认配置、分母/阈值均不改。只纠正XX-W01当前R2-4一次判定。26项过滤列表的既有确认及“旧生成文件无全文、额外字节差异无法归因”限制沿用，不再盘点或声称全配置不变。

下一步需要可核查的BMKG官方API文档/港口元数据出处，而本doc目录不能给出；本轮不猜新路径或KODE、不从链接文件名推导。JMA等待官方当前列表入口依据，PAGASA保留403，无重试。后续材料或请求范围交主会话决定，不自动消费旧额度。

单次采集harness rawexit0仅表示程序守住有界执行，原stdout/stderr/hash见[命令](capture-command.json)，不是来源合格PASS。定向文档/计数/引用验证、Markdown lint、归档与原输出hash、正常钩子及真实Neat Freak单列。原重复自动导入/固定wrapper DEP0190提示保留。产品/目录/生产/迁移/阈值不改，完整产品install/typecheck/lint/full Vitest/build、GUI/S7/24h本批NOT_RUN；整体R2未通过，无LLM/付费/merge/deploy/force-push，全部现场保留，待父审。
