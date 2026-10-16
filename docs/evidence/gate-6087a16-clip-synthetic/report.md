# 精确来源合成剪藏：离线通过，手动浏览器待验

本机Windows目录`D:\try one\Shipping HOT`，分支`codex/shipping-hot-r2`，产品SHA `6087a169cb2e591e3acb10d23ccc641d8212f5c0`。用户2026-10-16 14:12UTC+8批准Sentinel_93f0d70a11e88191be1cf2aac55064f7，仅额外支持唯一原始URL `http://127.0.0.1:5174/synthetic-article.html`。父审和真实手动Chrome仍pending。

## 实现

普通Vite/Nitro/扩展固定编译false，独立测试入口固定true；共享纯叶节点按原始整串比较，环境变量/请求头/Settings无法激活。别名、其他端口/路径、参数、fragment、凭据、编码/大小写/空白变体拒绝。只读DTO仅对原人工来源支持该例外。接收页和popup标记合成测试版，测试包禁用PWA。

启动器约束具备SHA标记的独立`.tmp/clipper-manual-<sha7>/run`、非链接DB、real、loopback5173、Runtime/intel关闭、无凭据；模块启动防护在监听前复核。来源5174只提供原创夹具，其他路径/Host拒绝、无重定向。沿用schema29/IntelRepository/版本/许可/去重/审计，不增加依赖、schema、Provider或来源。公开ID、三项权限、固定receiver/CSP、sender/document/nonce/TTL及显式保存不变。全局Host/Origin/CORS/SSRF、后端Readability未改。

## 精确SHA验证

新检出`.tmp/clipper-synthetic-final-6087a16`，Node24.15.0/ABI137/pnpm10.30.3；正常frozen install含scripts，未复用node_modules、ignore-scripts或手拷原生模块。普通build/typecheck/lint、普通扩展、合成app/扩展build均raw0；11文件173定向、138文件1437全量通过+3既有Windows跳过，三个隔离smoke均raw0。[原始门禁](summary.json)及逐命令日志保留。

同SHA/检出的HTTP步骤重试raw0，**108检查**见[结果](http-result.json)和[收据](synthetic-http-retry.json)：普通实际content.js VM与普通编译后HTTP拒绝本地精确URL及18变体，19URL拒绝前后DB增量0；正式 content.js 仍接受 HTTPS 元数据，避免全拒绝假阳性。合成content.js和HTTP仅接受精确URL、拒绝18变体。无标记cwd在建库前失败，原权限/key/receiver/CSP相同、标记存在。

隔离API测试显式保存元数据、本人原创全文及修订；既有GET核实真实本地URL、未知时间、正文空格/tab/连续换行、旧全文和元数据版本、重放/不变不增版/修订增版。[读回](http-saved-readback.json)。Provider usage/runtime/translation cache/intel fetch/executor增量0。该测试库有1材料3版本，**不用于用户交接**。没有实际Chrome操作，不能替代nonce交付/GUI。

## 原失败及恢复

1. 9377cc3首次定向172/173：新纯叶节点未列入只读依赖闭包。6087a16补清单并审计叶节点无import/require/process/globalThis/fetch/XMLHttpRequest，未弱化阈值；在新检出重跑全门禁。相邻gate-9377目录保留原件。
2. 6087首次HTTP raw1：pilot的Windows进程结束未生效，5273被占；原输出不改。核实PID/命令/父进程后仅停止本轮进程，在相同6087检出重试108项。
3. 实际HTTP驱动仍有不可靠的非强制taskkill，`ownReceiverStopExit=128`保留；全部检查后经[owned PID核实](http-owned-cleanup.json)仅停止该驱动的普通/合成receiver，source随后退出，5173/5174/5273无监听。监督清理后驱动raw0，**不声称驱动自行清理成功**。[实际执行脚本TXT](executed-http-driver.cjs.txt)。root修正清理版本未作为本次执行证据。

[completion.json](completion.json)明确12个前置命令raw0+同SHA最后一步重试通过，未将原summary改成全0。四个保留DB/Secret hash门禁前后与交接时相同。业务信源/付费/模型调用命令0；官方registry安装另列，不冒称整机逐包零外呼。

## 交接及限制

从干净6087构建复制无运行库的包，再初始化新零库，见[手动步骤](handoff.md)、[包清单](package-files.json)、[零基线](manual-zero-baseline.json)、[Neat Freak](closeout.md)。真实Chrome加载/点击/保存/重开/截图NOT_RUN；普通HTTPS、GUI/S7、24h均NOT_RUN。父审pending。R2整体BLOCKED（25/39、24/34、历史3/5），无生产启用、合并、部署、强推或删除现场。
