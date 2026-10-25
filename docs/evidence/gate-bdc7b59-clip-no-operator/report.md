# 人工剪藏免填录入人（2026-10-16）

用户15:14UTC+8要求“把这个去掉”（Sentinel_386b8dfb40ac8191b002c84c69d904d5）。本机`D:\try one\Shipping HOT`、分支`codex/shipping-hot-r2`，产品SHA **`bdc7b59d88d440966d8c6aff7fc68229c136dbb1`**。仅修改本次插件剪藏，不改政策库/其他人工表单、认证、schema、依赖、权限、公开ID、URL例外或桥接安全。

扩展popup和系统ClipImporter均移除录入人输入及错误提示；新popup不读取姓名。共享桥接解析器和剪藏专用后端对缺省/空白operator统一记录`未识别人工操作（未经身份认证）`，自动保留服务端保存时间、真实来源和必要审计。若旧客户端仍携带合法自填姓名，继续作为未经认证的历史兼容数据保留；旧记录/许可投影不改。非剪藏manualSubmit仍要求operator。正文声明/依据/范围/精确适用URL、网址安全、请求/幂等/版本和同源检查不放松。

## 验证

新干净检出`.tmp/clipper-no-operator-bdc7b59`，新frozen install含scripts、普通build/typecheck/lint、普通扩展及合成app/扩展build、**11文件190定向、138文件1454全量通过+3既有Windows跳过、3隔离smoke**全部raw0，详见[summary](summary.json)和逐命令日志。Node24.15.0/ABI137/pnpm10.30.3。未复用node_modules、ignore-scripts或手拷原生模块。已有6087的108项编译隔离HTTP证明未冒称在本SHA重跑；本次按适用范围跑原测试集合，包括真实H3同源POST缺省operator→SQLite→GET读回。

新增17回归：缺省/空白姓名跨桥接、预览显式提交和保存；审计默认值/服务端时间/许可读回/重放；旧姓名旧版本兼容；畸形旧字段仍拒绝；免姓名时未知权利/缺依据/错误适用URL/自动来源/不安全URL/额外认证字段仍拒绝；非剪藏缺省姓名仍拒绝；popup无输入、声明控件保留。早期局部检查96通过后补上非剪藏缺省项，最终以190/1454为准；一次测试引号lint已在提交前修复。

[真实Neat Freak](closeout.md)完成限定知识同步。新全门禁及交接时四个保留DB/Secret hash相同。业务信源/模型/付费请求命令0，安装registry下载另列，不推断整机逐包零外呼。GUI/S7由用户手动路径继续，**本SHA实际GUI/nonce/保存重开仍NOT_RUN，父审pending**；没有合并/部署/强推/生产或24h。

## 包与数据保全

旧6087扩展8文件及ZIP hash不变，[before-update](before-update.json)。新目录`.tmp/clipper-manual-bdc7b59/extension-test`，ZIP及hash见[synthetic-package](synthetic-package.json)。旧包未覆盖或删除。

切换前07:23UTC只读仍0材料/0版本/0人工动作；核实旧PID/命令/父进程后仅结束本轮旧receiver，source随之退出。新运行器复用原数据文件 **`.tmp/clipper-manual-6087a16/run/.data/shipping-hot-v3.sqlite3`**，没有搬库、清库或换UUID。另用SQLite原生backup保留一致快照`.tmp/clipper-manual-bdc7b59/original-database-before-update.sqlite3`。现库UUID仍`f79f2bd2-050f-42b0-831e-6e787eb1344f`、schema29/real，初始化来源42；07:24UTC材料/版本/动作及usage/runtime/cache/fetch/executor均0。[保全记录](preserved-database.json) / [切换后只读](after-update-readonly.json)。

原run标记6087仅表示既有隔离目录身份，未伪改为新SHA；实际app入口是bdc7b59新目录，[service证据](manual-service-health.json)分别记录actualCodeSha/isolationSha。模块启动防护原样执行。临时更新运行器在ignored.tmp，按既有source服务和OS-only环境启动规则复用，未加产品入口/动态开关/第二材料库。[脚本TXT](local-update-runner.cjs.txt)。receiver10880/source40064仅127.0.0.1:5173/5174，GET200，返回HTML及JS逐字节匹配新构建；source其他路径404，无重定向。上述PIDs是当时时点，应使用前复核。

用户需自行载入新目录并刷新接收页，详见[最短步骤](handoff.md)。没有操作其浏览器，也未把准备就绪宣告为实际GUI通过。R2仍BLOCKED：25/39、24/34、历史3/5。
