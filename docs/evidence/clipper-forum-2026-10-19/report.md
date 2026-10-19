# 论坛主帖误判修复候选（2026-10-19）

交审状态：源码未提交，基线`777007073f184d025147eb19f8ece86858e68362`，新审计版本`defuddle-0.19.2-dom-v3`。本次完整本地门禁针对固定文件摘要的工作源码快照，不是 clean-commit SHA 门禁；父会话独立审查、安装和 GUI 验收仍 pending。

## 行为与边界

已知模板仅在`body#nv_forum.pg_viewthread`主题详情、明确第一页URL、唯一标题和`#postlist`、首个直接帖子与正文/布局表数字身份一致时，向 Defuddle 的既有`contentSelector`传递已通过安全快照的首帖正文单元格。详情页后续回复不进入该正文；非第一页、身份歧义或主帖被 hidden/role/display 排除时提示改用选区，不回退到回复。

没有域名/文章ID/标题特判，也没有把所有帖子列表当正文。普通索引和推荐列表、长回复、错误配对、非第一页、隐藏主帖、资源节点及 PRE/表格边界均有原创负例或回归。后端、Schema、权限、Provider、Host/Origin/CORS/SSRF和现有用户包保持不变。

## 验证结果

- 原创五段夹具先红后绿；论坛专门用例23项。
- 全新隔离 frozen install（脚本启用，未复制旧 node_modules）、build/typecheck/lint/正式插件构建均 exit0。
- 相关12文件/240项通过；全量139文件/1504项通过、3项既有Windows跳过；3项原生持久化 smoke 通过。
- 用户桌面原文件93508字节，SHA256 `1d02a77ff25a0a247f26ce43abe53b9748cef09d7e92eb404329884e491aeaf3`；标题及来源核对通过。原文件仅只读解析，脚本/外链均未执行或加载，fetch尝试0次。
- 五段原文长度68/102/68/60/42，共340字；源DOM → snapshot → Defuddle → 最终纯文本每阶段都完整保留，逐字段序一致，每段恰好一次。独立正式bundle与源码输出完全相同，并通过10个原创包级正负例。
- 最终正文391字；五段含段隔应为348字。额外43字符含分隔符，其中35个非空白字符属于主帖内附件提示和关闭控件（3段残留）。此候选修复漏段，尚不能宣称纯净全文或所有论坛覆盖。原真实全文、HTML及密钥未写入仓库。

## 交审产物

- 完整代码diff：本地`.tmp/clipper-forum-v3-20261019/code.patch`，SHA256 `b493f931f2a6175e7fe41bd43bea2afa2866ae2184df3e570130ff6e82915f87`；包含新测试和类型项目路由，排除原有.gitignore/status改动。文档diff为同目录docs.patch，status只追加本轮条目。
- 独立正式目录：`.tmp/clipper-forum-v3-20261019/snapshot/.tmp/clipper-package`；zip：`.tmp/Shipping-HOT-Clipper-forum-dom-v3-20261019.zip`。
- content.js SHA256：`ad174d9fd407b46b64d0a618ba12abaaba361da6384c89b8da1b613e64bfc7e6`。正常包/固定公开ID、activeTab/scripting/storage，无host权限；包级负例确认拒绝合成HTTP例外、普通HTTP、带凭据和敏感query身份。
- [机器证据](summary.json)、[Neat Freak](closeout.md)；完整原始检查日志及无原文的回放元数据均保留在本地同名.tmp目录。

## 未完成与保留

尚未提交、推送、修改PR、合并、安装、切换5173服务或修改旧DB。原用户包8文件摘要、桌面原件及.gitignore保持不变；status既有字节完整保留，只追加本轮条目。R2整体仍BLOCKED，来源资格、GUI/S7及24h不因本候选提升。

保留全部失败日志和临时现场：首次沙箱安装EACCES经权限重试后正常完成；新增DOM测试按既有模式从Node项目路由到浏览器项目，仍由App类型项目检查；格式lint修复；全量初次缺rg经执行进程Path补齐后全量通过。没有为通过测试跳过断言。
