# 论坛首帖 P2：排序与筛选 query（2026-10-19）

父审指出dom-v3会在排序/筛选页把第一个合法帖子当主帖。本次候选`defuddle-0.19.2-dom-v4`只增加query白名单与版本标识；旧dom-v3候选/原用户包及其历史证据保留，当前候选以本报告和status新条目为准。HEAD仍`777007073f184d025147eb19f8ece86858e68362`，工作源码未提交，门禁针对摘要固定的隔离源码快照，不是clean-commit SHA门禁。

## 最小规则

pretty URL只允许`page`；`forum.php`只允许`mod/tid/page`。URLSearchParams解码后的键名精确小写匹配，所有出现的键都必须在白名单且只出现一次。原有第一页值、线程身份和DOM安全检查不变；任何额外参数都提示选区，包含ordertype=0/空值、pid/viewpid/stand/from、未知、大小写或数组键；不解析论坛排序。编码的合法小写键可用，编码后重复仍拒绝。

全局URL安全未改：authorid/AUTHORID/%61uthorid匹配现有auth敏感键规则，所以article/selection/metadata继续全部抛出`sensitive_clip_url`。其他通过原URL规则的排序/筛选URL仅article提示选区，selection/metadata仍可用。此URL白名单不证明服务器或浏览器不可见的排序状态，只支持已验证的默认未筛选第一页。

仅参考[历史Discuz3.1源文件](https://raw.githubusercontent.com/Discuz-X/DiscuzX/master/source/module/forum/forum_viewthread.php)确认排序和筛选确有行为分支，没有复制其代码或实现通用参数解析；不据此声称当前站点使用此版本。

## 回归与回放

三个新反例先红：完全合法post_202/pid202/postmessage_202回复在前、主帖101在后，唯一标题和postlist；ordertype/pid/viewpid原候选均静默返回回复。修复后81论坛用例通过（含58个本轮增加的默认/过滤/大小写/重复/编码和全局安全检查），与既有DOM共134项。新隔离快照全新frozen install/scripts，未复制旧node_modules；build/typecheck/lint/正式插件构建、298相关、1562全量（3既有Windows跳过）、3原生smoke均exit0。

独立正常bundle的64项离线检查通过，包括回复在前的两种URL、选区/元数据及敏感URL规则。用户桌面93508字节原HTML只读回放仍为340 → 340 → 340 → 340，五段逐字/顺序/次数正确（各一次），最终正文391字及SHA256与dom-v3默认原页输出一致。仍有35非空白字符附件提示/控件（含分隔额外43字符）；不宣称纯净全文或捕获时Chrome DOM证明。原文件和原文未进入Git，未执行原网页脚本/加载外链，fetch0。

## 交审身份

- 完整累计代码diff：本地`.tmp/clipper-forum-v4-p2-20261019/code.patch`，SHA256 `6ad23b458a5dfa50481fde9aacddb4f96792cf0bda9834861037691c63786e75`；P2增量为同目录`p2-delta.patch`，完整生产diff为`final-production.patch`。
- 正式独立目录：`.tmp/clipper-forum-v4-p2-20261019/snapshot/.tmp/clipper-package`，content.js SHA256 `12cef13d2863623b6fc9aaa9e15e2bccd6776898ffa9dce7210b283c84040630`。
- ZIP：`.tmp/Shipping-HOT-Clipper-forum-dom-v4-p2-20261019.zip`；固定公开ID/接收origin、权限及正常HTTP限制不变。
- [机器证据](summary.json) / [真实Neat Freak增量](closeout.md)。

保持未提交/未推送/未安装；父审复核、真实Chrome/GUI/S7仍pending/NOT_RUN；R2整体BLOCKED、来源资格、24h与预算状态均不提升。用户包8文件、旧候选、桌面原件、.gitignore及status本轮前字节保持不变；无旧DB打开、服务操作、Paid/Provider/迁移/网络设置改动。全部临时/失败现场保留，未清理。
