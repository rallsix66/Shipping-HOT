# Shipping HOT 人工剪藏

普通流程为**提取 → 预览 → 明确保存**。无需填写姓名、权利声明、保存范围、依据或时间角色。页面时间自动提取，缺失时为未知；标题和纯文本正文可在预览中编辑，正文最多100000字符，仍受原总字节/安全限制。

1. 用户主动点击扩展，提取当前文章或选中文字；“仅标题链接”仍是可选提取模式。
2. 预览后点击“送到 Shipping HOT 预览”；系统内再核对标题、实际来源和正文。
3. 用户明确“保存人工剪藏资料”，之后可查看正文和旧版本。刷新/关闭造成未保存草稿丢失时，重新提取即可。

新普通记录是**人工私人资料，权利未知**，不是获授权、官方核验或自动来源资格。审计记录manual_user_capture、private_material、rights unknown、未识别人工操作及服务端时间；不伪造授权字段，不授予自动采集、公开发布、模型使用或训练许可。新私人正文仅由本地人工详情读出，通用许可材料读取仍无正文许可。旧声明记录保留原声明和原读取限制；其他人工/政策表单与自动来源策略不变。

本地构建`pnpm build:clipper`输出`.tmp/clipper-package`。公开ID `jihkanbaffodclncabodmbahbbgkjoad`，仅activeTab/scripting/storage，无host权限/历史/cookie；接收地址严格`http://127.0.0.1:5173/feed`。文档绑定的一次性nonce草稿TTL120秒，系统同源显式保存，不改全局Host/Origin/CORS/SSRF或后端Readability。普通包仍限原HTTPS URL；唯一合成HTTP例外只存在于独立编译测试包，见[测试构建](../../tools/clip-synthetic/README.md)。

源代码实际复用、MIT及品牌边界见[来源清单](../../third_party/obsidian-clipper/README.md)。Defuddle0.19.2只运行惰性DOM提取；PRE选区保留原空白，article模式仍经过Defuddle既有代码块整理。无自动全站采集或读时模型调用。

文章提取候选修复（`defuddle-0.19.2-dom-v2`）在复制惰性DOM前排除明确标为`complementary`、`navigation`、`contentinfo`的块，以及HTML `hidden`或内联`display:none`的块。`aria-hidden`只描述无障碍树，visibility可被子元素覆盖，两者均不再作为整棵剪枝依据；不引入computedStyle或完整CSS算法。不会按“订阅”“购买”等正文词语截断，不新增站点文案/class/id黑名单，不修改选区模式或原网页。Defuddle既有class/id启发式和PRE整理保持原样；仅靠无结构标记的文本不能可靠识别推广尾段。候选包离线验证不代表真实新闻页已修复，实际部署/用户包状态仍见status。

新包/实际服务/手动验收状态以[status](../../docs/status.md)为准。包构建及离线测试不代表真实Chrome/nonce/GUI/S7通过；本轮待父审后才让用户更新包。旧包、数据库和全部现场保留。
