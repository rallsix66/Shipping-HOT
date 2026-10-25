# 人工剪藏结构边界候选修复（P2限定复审通过，本地提交交接）

本地目录`D:\try one\Shipping HOT`，沿用`codex/shipping-hot-r2`。完整门禁输入是基线`3506e61e47d6764189c27aaaf1b69e251c150305`加受控未提交源码快照；本轮提交SHA/动作结果以本地git记录及本机交接凭证为准，不能将这些历史门禁改称干净SHA验证。代码差异SHA256为`7bb6059e1e34a53609339103dd469bc50bc129b86b28b0899a9309f236f7fa66`，保存在本机`.tmp/clipper-tail-review-20261019/p2/final-code.patch`。这是差异指纹，不是产品Git SHA。

## 可验证的修复边界

链路是`content.ts → extractDocument → inertSnapshot → parseForClip/Defuddle0.19.2 → plainSelection`。旧快照只保留class/id/datetime/lang，丢失role/hidden/aria-hidden/内联样式的结构信息；原创DOM可复现非正文地标被复制成普通DIV，最终混入纯文本。

本轮仅在快照复制前，排除明确的`complementary / navigation / contentinfo`地标及HTML hidden、内联display:none的子树。主审两项P2已修复：不再仅凭aria-hidden或visibility:hidden/collapse整棵剪枝，不引入computedStyle或完整CSS算法。排除整块，不按正文关键词截断，排除块后面的正文仍保留。没有新增站点文案/class/id规则，不检查来源标题或域名。role=region、dialog不被新过滤器一概排除。

article审计版本升为`defuddle-0.19.2-dom-v2`；metadata/selection保持dom-v1。选区由用户明确选择，保持原行为。PRE选区空格、制表符、换行继续保留；article仍经过固定Defuddle的既有PRE整理，不将其冒称为原始DOM字节保真。无正文时仍明确报错并允许选仅标题链接。

不改后端Readability、Defuddle依赖、共享草稿/保存合同、版本去重、旧记录、许可、表单、权限、Host/Origin/CORS/SSRF、模型或调度。

## 主审P2负例修复

新增三项原创反例：aria-hidden=true视觉正文、visibility:hidden父节点内visibility:visible正文、visibility:collapse父节点内visibility:visible正文。修复前源码三项均将快照正文删空，修复后均精确保留。删除旧“aria/visibility删掉即成功”的用例，并改为保留正文断言。未改role、HTML hidden、display:none、显式选区或既有标签allowlist。

正式bundle三方比较同样成立：原abb1b99基线保留，上轮候选均报clip_empty_use_metadata，P2修复包均精确等于原创预期文本。不是以空输出作为成功；不存在真实页面内容。负例输入/输出与检查见本机`.tmp/clipper-tail-review-20261019/p2/bundle-smoke.json`的counterexamples。

## 验证

全新独立检出`.tmp/clipper-tail-p2-20261019`以HEAD加受控文件快照验证，未复制旧node_modules、数据库、.env或凭据。正常frozen install含原安装脚本；build/typecheck/lint及普通`build:clipper`通过。相关11文件217测试通过，其中DOM53项（较基线增加17项）；全量138文件1481通过、3项既有Windows跳过；p0-native/p2c-runtime/p3-feed-freshness三条smoke及diff-check通过。

直接执行新旧正式`content.js`的Node VM/linkedom诊断42项通过：同一原创DOM中旧包保留三类标记，新包均排除；正文/后续段落、引用、列表、表格、PRE边界和显式选区保持预期，普通包仍拒绝合成HTTP URL，manifest及三项权限与旧包相同。不是Chrome、GUI、nonce或S7证据。

新普通扩展仅位于`D:/try one/Shipping HOT/.tmp/clipper-tail-p2-20261019/.tmp/clipper-package`，未安装或替换用户包。content.js SHA256：`0628839376a48ce100d233b87909f868b0e703858df9ee3a59463aa72d5d0325`。

当前P2原始本机证据在`.tmp/clipper-tail-review-20261019/p2`：正常安装、build/typecheck/lint、相关/全量测试、smoke、red/green日志、42项bundle检查及保全。此前attempt2/attempt3和27项结果按历史保留，没有覆盖。精简可移交结果见[summary](summary.json)。

此前失败按历史保留（本次P2干净门禁全部raw0）：首次沙箱内安装EACCES，获准正常安装重试后成功；第一轮全量7失败由验证脚本向内存Runtime用例注入Runtime=false造成，移除测试进程覆盖后全量通过，未改测试/产品Runtime。首次VM辅助脚本缺浏览器全局URLSearchParams，补齐测试上下文后完成诊断，不是产品修改。

## 实际服务与材料保全

本轮未启停/更换任何服务，5173仍返回原abb1b99普通构建HTML，GET200。原已加载包8文件、正式/旧合成库、三个保留库与Secret共14文件hash未变，上轮待审候选包8文件也未变；两测试库各1材料/1版本/1审计，usage/runtime/translation/fetch/executor均0。正式记录的版本与正文hash仍与先前只读核对相同，private_material/unknown保持不变；未改写或“清洗”用户旧记录。正文与真实页面内容未写入仓库。

## 限制与审查点

- 没有原新闻DOM，无法确定三个混入尾段的实际父节点、role/class、链接/按钮边界、CSS可见性或是否只是正文内普通P。无法证明本修复命中该真实页面，也无法独立确认原文完整性。没有自动获取网页或浏览器控制。
- 固定Defuddle的class/id启发式仍可能误删正文：原创`subscription-research`容器在新旧bundle的同一长文夹具中均被删除。这只证明该单个新旧夹具结果相同；不能据此保证其他DOM没有新增误删，前置删块仍可能改变Defuddle的评分、选择或回退。不声称通用无损提取。无结构信号的推广尾段也没有被猜测删除。
- 本轮不判断真实视觉可见性。只删除aria/visibility整棵剪枝，不实现CSS继承/覆盖计算；角色错误标记仍可能误删，role仅检查第一个token。旧allowlist仍整棵排除article内aside/nav/footer，未新增其正文保留保证。
- 完整GUI/S7、真实页面重测、24h均NOT_RUN；R2仍BLOCKED（25/39、24/34、历史3/5）。无推送、PR更新、合并、部署、生产启用、付费或模型调用。
- 此前本地提交被自动审批引用旧“只交设计”范围拒绝且未执行。用户后续已明确允许仅本地提交，本次按新授权对该动作重试一次；准确结果以本地git记录和本机交接凭证为准。不推送、不更新PR、不更换插件或5173服务。缓存ignore改动留在工作区，不纳入本轮提交。
