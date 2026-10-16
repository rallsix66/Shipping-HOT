> 历史初次core实现证据：最终合成文章文字已同步并在abb1b99重跑完整门禁；当前包和动作以相邻[最终报告](../gate-abb1b99-clip-private/report.md)为准，不加载此旧staged包。

# 普通人工剪藏简化为私人资料（2026-10-16）

用户15:46UTC+8明确移除权利/范围/依据和时间角色表单（Sentinel_e20d7de212748191815c0f692ae9efd9）。这是用户对人工剪藏体验的新产品决定，ADR010的private-capture amendment取代新普通剪藏的旧声明必填规则；并非伪造本人原创或权限绕过。

本机目录`D:\try one\Shipping HOT`、分支`codex/shipping-hot-r2`；产品SHA **`e627c8d2b7937cfa4df6c63f93ad349835b730d8`**。没有schema/依赖/认证/生产配置/权限/Provider/全局网络安全变化，其他人工/政策表单和自动源策略未改。

## 实现边界

普通流程为提取→预览→明确保存。扩展不再生成rights声明或要求姓名/范围/依据/时间角色；页面时间自动取值、缺失为未知。系统预览只编辑标题和纯文本正文，保留最终保存/放弃和不确定响应重试机制。正文原100000字符、512KiB草稿体积和HTML/控制字符安全校验保留。URL、Host/Origin/CORS/SSRF、one-use nonce/document/TTL、普通HTTPS和精确合成URL编译隔离未改。

新普通请求省略legacy rights，服务端在原schema29 metadata_json记录独立审计：`capture=manual_user_capture / usage=private_material / rightsStatus=unknown / verification=manual_capture_unverified`及未识别操作者、服务端保存时间。不填假授权字段；正文仍存原Intel版本/blocks，不复制到审计，不另起材料库。可选时间缺失归未知，不以保存/抓取时间冒充发布时间。

本地人工详情投影仅对disabled、manual、精确MANUAL-CLIP来源、合法私人审计及匹配的canonical URL读回已存正文。**通用manualPersistenceFor对新私人格式仍返回disallowed，readIntelMaterial仍metadata_only/bodyText=null**，未赋予自动来源、公开发布或模型/训练正文许可。既有明确声明的记录及请求继续按legacy规则读写；新私人与legacy内容hash显式区分usage，即使正文相同也不复用并覆盖原声明版本。自动来源许可、旧官方补录产品URL边界保持不变。

## 验证

精确SHA新检出`.tmp/clipper-private-e627c8d`，Node24.15.0/ABI137/pnpm10.30.3；正常frozen install含scripts，普通build/typecheck/lint、普通扩展和合成app/扩展build，**11文件200定向、138文件1464全量通过+3既有Windows跳过、3隔离smoke全部raw0**。[原门禁](summary.json)和逐命令输出保留。没有复用node_modules/ignore-scripts/手拷原生模块。

在同一检出的**编译后普通生产服务**、新隔离real库、loopback5273完成[22项HTTP检查](compiled-http-result.json)：无姓名/无声明/无日期的主动确认正文POST200，超过280字符且含空格/tab/空行的正文精确GET读回；审计私人/权利未知且没有rights声明；未知时间、重放/不变不增版、旧元数据版本保持；跨Origin/HTTP本地URL/危险或超限正文/自动来源/伪授权字段均拒绝，拒绝前后库零增量；usage/runtime/cache/fetch/executor0。[合成读回](compiled-http-readback.json)。只结束自己创建的PID45328进程树，cleanup raw0，5273随后无监听。没有浏览器或外部页面请求。

新增10回归并保留所有旧断言：缺省声明跨桥接/显式保存、私人审计与通用许可读隔离、旧许可旧版本兼容/同内容不覆盖、缺失日期、body安全上限/自动来源、H3私人与legacy两条HTTP、两种详情展示；popup无必填控件检查同步。两处TSX按实际React Best Practices技能检查：无新增hooks/请求/危险HTML，类型判别展示，原显式保存/busy/重试逻辑保留。真实Neat Freak见[closeout](closeout.md)。

## 数据、包及待复审

原用户隔离库路径/UUID/内容未改，07:59UTC仍0材料/版本/操作及usage等；原服务仍运行bdc7b59，PID10880/40064、127.0.0.1:5173/5174均200。[当前现场](current-user-scene.json)。四个保留DB/Secret hash不变。6087与bdc旧包8文件及ZIP完整保留。新包`.tmp/clipper-manual-e627c8d/extension-test`和ZIP仅staged；[包/hash](staged-package.json)。

**按本轮要求先交父审，再更新接收服务和用户扩展。新e627尚未切换当前5173，也未让用户加载；不得只更新扩展就用旧后端测试。** 已准备复用原DB文件的受限更新脚本，未执行；[交接步骤](handoff.md)。新包真实GUI/nonce/保存重开NOT_RUN，父审pending；普通HTTPS浏览器、完整GUI/S7、24h未验。R2仍BLOCKED：25/39、24/34、历史3/5。无合并/部署/强推/付费/模型调用/清场。
