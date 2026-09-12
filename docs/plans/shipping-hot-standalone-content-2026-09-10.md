# Shipping HOT 独立化与内容完善（本轮唯一现役计划）

> 状态：`APPROVED / ACTIVE`。本文件是本轮唯一正式执行计划。
> 编制/整合日期：2026-09-10（Asia/Shanghai）。
> 阶段编号：S0–S8（仅表示本轮阶段，不重新编号或改写历史 V3 的 P0–P7）。
> 现役状态权威：`docs/status.md`；当前批准结构：`docs/architecture.md`；AI 进入规则：`AGENTS.md`。
> 历史 V3 计划已归档为 `docs/archive/shipping-hot-v3-real-data.md`，只作历史证据，不是现役执行入口。

本文件把用户 2026-09-10 提供的《Shipping HOT 独立化与内容完善实施方案》整合进草稿分支已有的工作单，作为唯一现役计划；不另建 V4 计划、阶段报告、验收报告或交接副本。已封版 V3 的失败记录、例外与覆盖缺口保留在归档文件中，不因归档而消失。

## 0.1 本轮交付范围（2026-09-11 用户澄清，覆盖原方案的部署相关假设）

- 本轮交付范围：**Windows 本地完善与验收**。最终交付一个能在本地完整安装、启动、实际使用且数据可靠的版本，由用户判断是否进入服务器阶段。
- **服务器部署与实机发布验收不属于本轮**，列为后续待授权范围：不连接服务器、不安装服务器软件、不部署或切换服务。只有用户认为本地版本可用并另行明确授权，才考虑服务器阶段。
- **Docker 容器验收不属于本轮本地阶段的必需项**：保留现有 `Dockerfile`/compose 配置及其“未验证”真实状态，后续采用 Docker 时再补验；不把延期写成通过，也不以缺少 Docker 阻塞本地开发（`pnpm dev`、`pnpm start`、本地浏览器验收仍为本地必需）。
- 本地必需项包括：Windows 干净环境**完整**依赖安装（不使用 `--ignore-scripts`、旧 `node_modules` 或手工复制原生模块冒充通过）、构建/类型/lint/全量测试、本地浏览器交互验收、数据兼容与隔离、文档与收尾。
- S1 本地范围内必需项全部通过、审查与收尾完成后，记录“S1 本地范围 PASS；Docker 未验证，不属于本轮交付范围”，随后继续后续本地功能阶段，不重复申请已批准的功能范围。

## 0. 现场基线与差异核对（执行时以实际为准）

本计划编制/执行时的现场（核对时间见 `docs/status.md` 本轮记录）：

| 对象 | 方案编制时假设 | 核对时实际 | 处理 |
| --- | --- | --- | --- |
| 主分支 | `main@6f0a22cb271c4504237798f806d6695ee49bdd08` | 一致 | 作为比较基线，不直接推送 |
| 已验证业务代码历史基线 | `e34115870804c0ef0040a568968c9ecce81af786` | 一致 | 仅历史验收索引，不冒充本轮受测版本 |
| 实施分支 | `codex/shipping-hot-standalone-first-pass` | 远端存在，本地初始未 fetch | 接续该分支，不另起重复实现 |
| 草稿 PR | PR #1，未合并，头提交 `4b5ff00a01aae9e8298ad088261440d2218e668b` | 存在、DRAFT、头提交一致 | 复用该 PR；保留原有三个提交，追加阶段提交 |
| 首批改动 | 7 个文件 | 一致（Dockerfile、两份 compose、`.dockerignore`、根 README、检查 workflow、工作单） | 逐项复核后复用，不当作完整独立化完成 |
| 工具链 | Node `24.15.0` / pnpm `10.30.3` / ABI `137` / `better-sqlite3@12.6.2` | 一致 | 本轮统一构建/运行/测试；不顺手升级框架或包 |
| 分支保护 | 编制时未启用传统保护 | `main` 无 protection，rulesets 为空 | 最终合并按 7.5 复核 |
| Workflow | 检查/发布自动触发 | 三个 active：`shipping-hot-checks.yml`、`docker.yml`、`release.yml` | S0 静默并入 7.2 策略 |
| 未提交/未跟踪 | — | `src/components/shipping/pages.tsx` 仅行尾差异（0 内容行）、`.tmp/` 未跟踪且未被忽略 | 保留，不清理用户遗留内容 |

现场不同时就核对差异、记录并按实际情况维护，不强制回退、不覆盖用户未提交内容。

## 1. 本轮目标与不再争论的方向

保留 **Vite + React + Nitro + db0 / SQLite 模块化单体**，保留 Windows 本地、localhost 单用户边界，不引入 Supabase、Next.js、微服务或独立消息队列。正常业务入口应显式使用真实模式；演示和测试才显式使用 Mock，二者数据库与显示标识分开。去掉 NewsNow 的产品身份及无关业务，但必要许可证、第三方依赖署名、历史记录和数据兼容标识属于例外（例如仍在用的上游 ESLint 配置不因作者名出现就替换）。

`docs/archive/shipping-hot-v3-real-data.md` 的封版条件、例外、失败记录和覆盖缺口仍有效；旧文档中的 title/summary-only 和手工逐条准备方式只描述历史边界，不构成永久拒绝新增需求的理由，但新增目标在实现前一律标 `approved`，不得写成现有能力。

## 2. 文档维护：V3 归档，本轮只保留一个计划入口

| 文件/位置 | 本轮维护内容 | 更新时机 |
| --- | --- | --- |
| `AGENTS.md` | 产品定位、真实命令、数据/安全边界、阶段验收、CI/提交规则、正式计划入口 | S0 更新批准边界；后续只随真实规则变化 |
| `docs/architecture.md` | 当前批准结构、正文/译文归属、日历更新与展示隔离、Provider/运行边界 | S0 形成变更合同；S4/S5/S6 按实施复核 |
| 本工作单 | 范围、顺序、验收条件、依赖、回退、V3 遗留项承接 | S0 整合；后续修改对应条目 |
| `docs/status.md` | 当前实际状态、每阶段实际验收结果、被测版本、缺口、下一步、证据索引 | 每阶段结束更新一个现役摘要及对应证据区块 |
| `docs/v3-real-provider-matrix.md` | 已有及候选来源的可达性、权限/费用核对、目标覆盖、真实证据 | S2、S3、S6 和真实来源验收时 |
| `docs/live-verification.md` | 实际 Provider → SQLite → API → 浏览器、重启及零 Mock 的详细证据 | 真实验证时，不用 Mock 结果填充 |
| `docs/voyage-provider-gap.md` | CNYPG 等映射、当前 ETA 与商业船期的区别、候选来源及受阻条件 | S2、S6 |
| `docs/data-candidates/calendar/` | 各国既有资料，官方文件、变化和核对差异 | S3 资料更新时 |
| `server/data/annual-calendar/` | 通过验证的年度展示数据，不放工作笔记 | S3 正式晋级数据时 |
| `docs/plans/inbox/shipping-hot-translation-t3.md` | 保留旧 T3 批准与验收历史；指向新的扩展边界 | S0/S5，不重开或重做旧 T3 |
| `README.md` / `CONTRIBUTING.md` | Shipping HOT 真实使用、启动、构建、数据边界与贡献说明 | 对应行为变更后 |
| PR #1 / Actions | 阶段提交关联、最后准确 SHA 的 CI 和合并后验收凭证 | 随阶段/最终合并更新，不创建新报告体系 |

必要架构决定按 `docs/adr/` 既有机制登记（当前 ADR 001–005）。确有新数据归属/接口/Provider 决定时使用下一个未占用编号记录一份必要 ADR，并在旧 ADR 标注被部分替代的范围；不篡改旧决策当时内容，不为每个小修创建 ADR。

历史、现役和证据必须区分：已封版 ≠ 新增目标也通过；已实现 ≠ 用户实例已运行或数据完整；本地验收通过 ≠ 容器/Windows/真实 Provider 都通过；已合并、CI 通过、已部署、实机验证分别记录，不合并成一个“完成”。`docs/status.md` 只保留一个当前权威摘要。

## 3. 范围与架构合同

### 3.1 当前八港范围

以 `shared/port-directory.ts` 当前列为基线（不是本轮重新认证身份或坐标）：蛇口 `CNSHK`、盐田 `CNYTN`、南沙 `CNNSA`、林查班 `THLCH`、巴生港 `MYPKG`、马尼拉 `PHMNL`、雅加达 `IDJKT`、胡志明市 `VNSGN`。`CNYPG` 是现有航次来源待关联的目的港标识，保留供应商原值，只有确凿身份关系才能绑定本地港口；不得为消除“未映射”随便匹配，新增港口先登记范围变更。为每个目标港口分别维护目录身份、拥堵、AIS 观测/估算、天气预报、官方预警、官方公告、航次关联状态。目录有八港不等于七类能力都覆盖八港。

### 3.2 三类数据目标链路

```text
运营数据：已批准 Provider → BackgroundRuntime → Repository / SQLite → API → 页面
参考日历：官方资料收集与校验 → 版本化年度 JSON → 既有 reference GET → /calendar
文章内容：资讯发现 → 安全正文提取 → 原文版本/段落 → 既有翻译体系扩展 → 缓存 → 阅读页
```

页面不直接请求第三方 API 或操作 SQLite；文章/翻译 GET 不发起模型请求。对已有承担“搜索”的接口逐一登记其外部调用合同，不把“一切 GET 都 provider-free”写成与实际代码冲突的口号。

### 3.3 原文、译文和证据归属（S0 仅确认逻辑实体，表名/迁移序号执行时固定）

| 逻辑实体 | 必备内容与约束 |
| --- | --- |
| 来源 | 机构、原始 URL、规范 URL、内容类型、适用范围、访问/再分发政策、最后核查时间 |
| 原文版本 | 对应 Feed/公告、语言、发布/更新时间、抓取时间、正文 hash、提取器版本、完整性状态；修改形成新版本而非覆盖 |
| 内容块 | 稳定 block ID、顺序、类型（段落/标题/列表/表格/图注）、原文、必要链接和结构；同版本顺序唯一 |
| 译文工作状态 | 原文版本与 block/hash、目标语言、Provider/model、术语/提示词版本、成功/失败/重试/租约、完成时间、用量关联 |
| 衍生证据 | Event/HOT/数值指标连接真实来源记录与观测时间；没有文章时展示证据，不伪造“原文全文” |

优先复用 `TranslationService`、`TranslationRepository`、`translation_cache`、`provider_usage`、后台重试及熔断。原文版本可在同一 SQLite 增加最小必要结构；不把长正文塞进首页响应，不复制独立计费/密钥系统。**全文增强不改写原始 Feed、事件严重度、去重、时效或 HOT 排序**；全文里发现新风险的自动分析不包含在本轮。

### 3.4 日历与商业船期边界

日历先覆盖 TH/ID/MY/PH/VN 的当前年和下一年；国家年度假日、地区/机构差异、补班补休及补充公告分别表达。下一年官方尚未公布可显示“尚未公布”，已公布而未采集必须显示缺口。商业船期是承运人公布的挂港/路线/航次/ETD/ETA，不是 AIS 位置或当前航行 ETA；免费条件必须针对实际账户、用途和配额核对。DCSA 是规范，不是自动提供全球数据的免费 API。

## 4. 通用测试、验收和提交门槛

### 4.1 每阶段流程

```text
实施 → 相关模块测试 → 本地完整工程门禁 → 阶段专项验收
→ 独立审查 → 真实 Neat Freak 收尾与现有文档同步
→ 对最终待提交内容复核 → 阶段提交/推送 → 下一阶段
```

纯文档阶段可用文档链接、规则一致性、workflow 静态校验等专项检查，但 S0 仍需建立一次完整代码基线；代码/配置/数据改动阶段必须运行完整工程门禁（4.3 G）。阶段内可保存 WIP commit，但 WIP 不等于阶段通过。阶段通过自动进入下一阶段，不必逐阶段等用户批准；涉及新授权、重大偏离或受阻项时才停止相关路径。每阶段正式完成状态包含收尾；真实 Skill 缺失时按项目规则标 `pending`，不自造审计冒充已执行。

### 4.2 四种阶段结论

| 结论 | 定义 | 是否能继续 |
| --- | --- | --- |
| PASS | 全部必需检查满足，受测版本与证据完整 | 可以 |
| FAIL | 检查已执行，结果不符合标准 | 修复后重跑，不进入依赖阶段 |
| BLOCKED | 缺权限、预算、环境、上游数据等，必需检查不能执行 | 只继续不依赖该项的工作；不能标完成 |
| NOT_RUN | 尚未执行 | 不能作为通过依据 |

`N/A` 只用于真正不适用的单项检查，写理由；不能把做不了的项改成 N/A。接受覆盖限制或延期必须有用户明确决定并记录交付范围。

### 4.3 工程门禁 G（完整本地检查）

执行环境应为干净检出/受控目录；不得加载用户真实 `.env.local` 或默认保留数据库。依赖安装允许访问包注册服务，测试不应对真实 Provider 发请求。当前项目需先构建生成 `dist/.nitro/types`，原生重启测试依赖 `.tmp` 父目录。以下为现有命令，非新增脚本。

Windows PowerShell（每步非零即停止）：

```powershell
$ErrorActionPreference = 'Stop'
function Invoke-Checked {
    param([string]$File, [string[]]$Arguments)
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed: $File (exit $LASTEXITCODE)" }
}
# 前提：此目录无真实 .env.*，进程环境中的 Provider 凭据已被隔离。
Invoke-Checked -File 'node' -Arguments @('-e', 'if(process.version!=="v24.15.0"||process.versions.modules!=="137")process.exit(1)')
if ((& pnpm --version).Trim() -ne '10.30.3') { throw 'pnpm version mismatch' }
$env:SHIPPING_DATA_MODE = 'mock'
Invoke-Checked -File 'pnpm' -Arguments @('install', '--frozen-lockfile')
Invoke-Checked -File 'node' -Arguments @('-e', 'require("node:fs").mkdirSync(".tmp",{recursive:true})')
Invoke-Checked -File 'pnpm' -Arguments @('build')
Invoke-Checked -File 'pnpm' -Arguments @('typecheck')
Invoke-Checked -File 'pnpm' -Arguments @('lint')
Invoke-Checked -File 'pnpm' -Arguments @('exec','vitest','run','-c','vitest.config.ts')
Invoke-Checked -File 'git' -Arguments @('diff','--check','origin/main...HEAD')
Invoke-Checked -File 'git' -Arguments @('diff','--check')
Invoke-Checked -File 'git' -Arguments @('diff','--cached','--check')
```

通过标准：退出码均为 0；无未解释失败；无新增未接受警告；测试数量变化可解释。旧 NewsNow 专属测试随业务退役可移除，但记录理由；禁止为通过而删 Shipping HOT 失败断言或排除文件。

干净环境完整安装（本轮 Windows 本地必需）：必须以真正干净的检出运行 `pnpm install --frozen-lockfile`，不得使用 `--ignore-scripts`、复用旧 `node_modules` 或手工复制原生模块来冒充“完整安装通过”。当前 `better-sqlite3@12.6.2` 的 install 走 `prebuild-install`（官方预编译包）；本机网络下载约 20–40s，而 `prebuild-install@7.1.3` 硬编码 30s 超时会导致 `unexpected end of file` 并回退 `node-gyp`（缺 VS C++ 工作负载）。已用 pnpm 补丁把该超时改为可配置/180s（`patches/prebuild-install@7.1.3.patch`），使干净安装可复现；不再以 VS 工作负载或 `--ignore-scripts` 作为通关途径。

### 4.4 UI 测试特别限制

`test/ui-smoke.test.ts` 是 `renderToString` 原语检查，不是浏览器点击测试。本方案要求另有可重复的真实浏览器自动化：优先执行环境已有浏览器工具；若项目内无可重跑端到端脚本，在现有 `test/`/`scripts/` 补齐并在 `package.json` 登记实际命令。不得只写尚不存在的 `pnpm test:e2e` 就算交付。实际验收连接构建后的 Nitro 服务与隔离 SQLite，不替换整站 API；外部 Provider 可在离线场景受控替换，但证据必须标“离线端到端”，不标真实接入。

### 4.5 验收记录写回 `docs/status.md`

每阶段使用字段：阶段/验收 ID、时间（ISO 及时区）、被测代码（commit SHA，有未提交变更时附基础 SHA + diff/tree hash）、环境（OS、Node、pnpm、SQLite 模块、schema、浏览器/镜像版本、数据模式）、测试数据（隔离库标识、固定样本或真实来源，不暴露密钥与敏感路径）、执行项（实际命令、退出码、通过/失败/跳过数量）、预期/实际（逐验收 ID）、证据（脱敏日志/截图/查询结果/来源文档/PR 入口）、审查与收尾、结论与推进、交付提交。不把 commit 自己的 SHA 预先写入该 commit 正文；钩子改了内容则相关检查重跑。

## 5. 阶段总览

| 阶段 | 目标 | 主要依赖 | 阶段结束后 |
| --- | --- | --- | --- |
| S0 | 核对基线、V3 归档承接、批准架构、关闭中途 CI、建立测试基线 | 无 | 允许进入独立化；外部来源研究可在现有文档中提前开展 |
| S1 | 独立产品、构建运行、安全入口和验证基础 | S0 | 可重复运行自己的 Shipping HOT |
| S2 | 真实数据与八港覆盖逐项验收 | S1 | 明确哪些能力真实可用、哪些仍缺失 |
| S3 | 日历官方资料更新与年度数据闭环 | S1 | 五国参考日历可追溯、可更新 |
| S4 | 原文获取、完整性、版本与来源追溯 | S1；使用已批准资讯来源 | 文章主体与来源证据可持久化、可读取 |
| S5 | 完整正文翻译与双语阅读 | S4 | 全文翻译可恢复、可对照、不冒充完整 |
| S6 | 商业船期研究决定及条件满足后的接入 | 研究从 S0 开始；实现依赖 S1/S2 | 真实接入通过，或明确受阻/经批准延期 |
| S7 | 干净环境完整验收、文档与收尾 | 所有纳入交付的阶段 | 形成待合并候选版本，等待合并授权 |
| S8 | 最终合并 CI（本地范围内）；服务器部署/实机发布为后续独立授权 | S7、单独合并授权 | 记录 merged / CI passed；deployed / live verified 未授权则 `NOT_RUN / 后续待授权` |

默认按顺序推进；上游授权受阻时只允许先做不依赖该授权的阶段。任何被延期的原需求必须在最终交付清楚列出。

## 6. 各阶段验收 ID

### S0 基线、文档承接、架构合同与 CI 静默

实施：核对 checkout/远端/PR/未提交/worktree；逐文件检查首批补丁；归档 V3 并维护本工作单；加载真实 Project Architect 与 Neat Freak Skill；先处理 CI 触发策略再推送；建立干净环境基线并记录原有失败；把新增持久化、迁移回退、来源准入、受控真实验收预算及保留内容写成可执行合同。

| ID | 验收项目 | 必须达到的结果/证据 |
| --- | --- | --- |
| A0-01 | 现场基线 | 分支、HEAD、PR、未提交/未跟踪清单有记录；已有改动未被覆盖；不凭记忆写版本 |
| A0-02 | V3 归档 | Git 显示原计划可追溯迁移；封版证据和例外保留；现役入口改指本轮计划；有效内部链接无断裂 |
| A0-03 | 唯一计划 | 草稿工作单成为唯一正式计划；没有新增 PLAN/TODO/阶段报告副本；遗留项有明确承接 |
| A0-04 | 架构与规则 | 旧 title/summary-only 等限制标注历史适用范围，新目标标 approved/implemented 真实状态；不把计划写成现有能力 |
| A0-05 | CI 静默准备 | 相关 workflow 设置及文件已核对；后续阶段 push/PR 更新不会触发检查或发布；无权限时停在本地 |
| A0-06 | 基线工程检查 | G 门禁完成，实际数量、环境、警告记录齐全；环境/基线失败标 FAIL/BLOCKED，不继续破坏性清理 |
| A0-07 | 测试隔离 | .env、凭据、库地址、数据卷和外部调用限制明确；不是只声明“测试环境” |

专项：Markdown 链接/锚点、AGENTS 入口加载、Git 重命名/差异、YAML 与事件过滤规则、现有完整测试。建议提交 `chore: S0 establish standalone execution baseline and CI policy`。

### S1 独立产品、可重复构建与本地访问边界

涉及：`package.json`、锁文件、`.nvmrc`、Dockerfile、两份 Compose、`.dockerignore`、`nitro.config.ts`、`vite.config.ts`、`pwa.config.ts`、`index.html`、README/CONTRIBUTING、`src/routes/`、`src/components/`、`server/api/`、`server/middleware/`、`server/sources/`、`shared/sources*`、`scripts/source.ts`、`scripts/favicon.ts` 及相关工具和测试（目录名只是定位入口，删除按引用分析）。

实施：按引用分析移除旧资讯业务、无关路由、OAuth/用户同步及专属缓存调用链，先解引用再删依赖；`server/sources/aihot.ts` 退出运行链（AIHOT 仅作全文阅读设计参考）；旧数据库表不因代码退出而 DROP。统一包名、标题、PWA、图标/元信息、产品链接，禁止残留上游赞赏/演示站跳转/假更新提示；保留 LICENSE、必要署名、历史材料及未迁移数据兼容标识并列白名单，不做全仓字符串盲删。统一 Node/pnpm；Compose 构建本仓库；核验生产产物中原生 SQLite 可加载，测试文件不得作为生产 API 路由打包/暴露。梳理旧 Cloudflare/Vercel/Bun 等未维护分支，退出不能支持当前 SQLite/后台 Runtime 的公开启动方式。统一 dev/`pnpm start`/容器/CLI 的数据库与环境解析（CLI 的 `SHIPPING_DATABASE_PATH` 不能假定 Nitro 也接受，必须实测）。正常运行显式 Real，隔离演示显式 Mock；保留库缺失时不偷偷打开空库冒充迁移成功。本地单用户不新加账号系统，但必须消除旧 `/api/s` 前缀误判，明确 Host/Origin/跨站写入边界，敏感写接口校验方法、Content-Type、体积和字段；不使用开放 CORS，不返回密钥；localhost 非浏览器调用是否允许需明确记录。

| ID | 验收项目 | 必须达到的结果/证据 |
| --- | --- | --- |
| A1-01 | 产品独立 | 保留页面/manifest/运行包信息/主动外链指向 Shipping HOT；旧业务路由不可用；必要例外有白名单 |
| A1-02 | 引用与依赖 | 删除路径无活动引用；无孤立生成脚本；不因上游作者名误删共享依赖；锁文件与 manifest 一致 |
| A1-03 | 工具链 | Windows 目标 Node=24.15.0、pnpm=10.30.3；**干净环境完整安装**后原生模块实际加载成功（Docker 内验证不属本轮本地必需项） |
| A1-04 | 运行产物 | `pnpm build`、`pnpm start` 在 Windows 本地实际启动成功；无测试 API/runner；生产包含运行所需原生模块（Docker 启动不属本轮本地必需项） |
| A1-05 | 数据路径 | 用唯一隔离路径写入记录并重启后可读；dev/start/CLI 指向预期位置；保留库未打开/未改写（容器路径未验证，不属本轮） |
| A1-06 | 访问边界 | 宿主机监听回环；恶意 Host、跨站写、错误类型/超大请求被拒绝；正常本地功能通过；无密钥进入响应/日志/静态文件 |
| A1-07 | 数据不丢 | 新旧版本对隔离数据副本的关注/设置等保留字段核对一致；物理卷名未悄悄改成新空卷 |
| A1-08 | 回归与收尾 | G 全过；真实浏览器访问保留路由与核心交互通过；文档/规则/运行行为一致；无未解决阻塞 |

注：本轮交付范围为 **Windows 本地**。上表原本含有的 Docker/容器子项（A1-03/A1-04/A1-05/A1-08 的容器部分）**不列为本地必需项**；保留 `Dockerfile`/compose 配置及其“未验证”真实状态，后续采用 Docker 时补验，不把延期写成通过，也不以缺少 Docker 阻塞本地开发。

失败处理：先修引用或隔离，不用 `--force` 安装、关闭类型检查或删数据库。回退只恢复本轮代码/config，不删原卷。阶段提交 `refactor: S1 make Shipping HOT standalone`。

#### S1 引用分析结论（2026-09-11，实施前写回）

方法：对 `server`、`src`、`shared`、`scripts`、配置与测试做只读 import/引用分析，区分 Nitro 文件发现（`server/api`/`middleware`/`plugins`）、unimport 自动导入（`server/utils`、`shared`、`src/hooks|utils|atoms`）与真实 import；排除 `.tmp/` 诊断副本。

**删除（旧 NewsNow 业务，解引用后执行）**
- Server：`server/sources/**`（48 文件，含 `aihot.ts`）、`server/getters.ts`、`server/glob.d.ts`、`server/api/{latest,login,enable-login}.ts`、`server/api/me/**`、`server/api/oauth/**`、`server/api/s/**`、`server/database/{cache,user}.ts`、`server/types.ts`、`server/utils/{source,rss2json,date,crypto,base64,fetch}.ts` 与其测试 `server/utils/date.test.ts`。
- Client：`src/routes/c.$column.tsx`；`src/components/{column/**,navbar.tsx,header/**,footer.tsx,common/search-bar/**,common/dnd/**,common/overlay-scrollbar/**}`；`src/atoms/{index.ts,primitiveMetadataAtom.ts}`；`src/hooks/{useSync,useLogin,useRefetch,useSearch,useFocus,useRelativeTime,query}.ts`；`src/utils/data.ts`。
- Shared：`shared/{types,pre-sources,sources,sources.json,updated-sources,metadata,verify,utils}.ts`、`shared/pinyin.json`。
- 构建/部署/资产：`scripts/{source,favicon}.ts`、`presource`/`preview`/`deploy`/`log`/`release` 脚本、`example.wrangler.toml`、`wrangler`/`workerd`、`public/icons/**`、NewsNow `public/{icon.svg,og-image.png,pwa-192x192.png,pwa-512x512.png,apple-touch-icon.png,sitemap.xml,sw.js}`、`screenshots/reward.gif`；`README.zh-CN.md`/`README.ja-JP.md`。
- package 依赖（仅旧 NewsNow 使用）：`@atlaskit/pragmatic-drag-and-drop*`、`@iconify-json/si`、`@tanstack/react-query-devtools`、`@tanstack/router-devtools`、`ahooks`、`cmdk`、`cookie-es`、`iconv-lite`、`jose`、`md5`/`@types/md5`、`pnpm`(runtime)、`react-device-detect`、`uncrypto`、`@napi-rs/pinyin`、`bumpp`、`favicons-scraper`、`mlly`、`pnpm-patch-i`、`overlayscrollbars`、`defu`（若 overlay-scrollbar 删除后无他用）。

**保留（Shipping HOT / 底座 / 共享）**
- Server：`server/api/shipping/**`、`server/database/**`（Shipping/migrations/runtime）、`server/providers/**`、`server/runtime/**`、`server/services/**`、`server/search/**`、`server/secrets/**`、`server/shipping-store.ts`、`server/plugins/background-runtime.ts`、`server/utils/logger.ts`。
- Client：`src/components/shipping/**`、Sharing 路由、`src/components/common/toast.tsx`、`src/hooks/{useDark,useToast,useOnReload}.ts`、`src/utils/index.ts`（`myFetch`/`Timer`，移除 NewsNow-only helper）。
- Shared/工具：`shared/dir.ts`、`shared/type.util.ts`、`shared/shipping*.ts`、`shared/voyage*.ts`、`shared/ais-area*.ts`、`shared/port-directory.ts`、`shared/annual-calendar.ts`、`shared/calendar.ts`、`shared/vessel-search.ts` 等 Shipping 契约；`scripts/load-env.ts`、`scripts/tsx-alias-loader.mjs`。实施时补充结论：`tools/rollup-glob.ts` 只为 `server/getters.ts` 的 `glob:` 导入服务，随 getters 删除后成为死代码，故连同 `fast-glob`/`@rollup/pluginutils` 一并删除（此前分析曾标保留，以本实施结论为准）。
- 保留数据与卷：`newsnow_data` 物理卷与旧 `user` 表数据不 DROP；用户 `.tmp/`、`pages.tsx` 行尾状态、`.data/` 保留库与密钥不动。

**替换/修改（不是简单删除）**
- `server/middleware/auth.ts`：含 `/api/s` 前缀误判（同时匹配 `/api/shipping/**`）。删除旧 OAuth 后用 Shipping 访问边界替代：消除前缀误判、保留本地访问与敏感写入校验（A1-06），不保留 GitHub/JWT 登录。
- `src/routes/__root.tsx`：移除 `useSync()`；`usePWA()` 去掉对已删 `/api/latest` 与 NewsNow release 链接的依赖，仅保留 PWA 注册/更新提示能力（不删整个 PWA）。
- `vite.config.ts`：unimport dirs 去掉 `metadata/sources/verify` 等已删项。
- `uno.config.ts`：移除对 `shared/sources` 的 safelist 依赖。
- `nitro.config.ts`：保留 `node-server` + `better-sqlite3`；去掉 Vercel/CF/Bun 分支；加 `ignore: ["**/*.test.ts","**/*.spec.ts"]` 防止测试文件被打成生产路由。
- `package.json`：改 `name`/`author`/`homepage`，`dev`/`build` 去掉 `presource`。
- `index.html`/`pwa.config.ts`/`public`：改 Shipping 身份 meta/OG/theme-color，移除 NewsNow GA 与旧域名；保留 PWA 能力。
- `shared/consts.ts`：移除仅旧业务使用的 `TTL`/`Interval`，保留/改造 `Version` 等仍有用途项。

删除的旧 NewsNow 测试：无（`test/common.test.ts` 之外，无测试引用旧 sources/UI；`server/utils/date.test.ts` 随其模块退役）。测试文件 `server/api/shipping/index.test.ts`、`translation/secret.test.ts` 是 Shipping 测试，只从路由扫描排除，不删除。

#### S1 补修与补验结论（2026-09-11 续）

- **A1-06 重开并收紧**：`server/middleware/security.ts` 现拒绝 `Origin: null`、把来源按协议+主机+端口精确比对（同源或 `SHIPPING_ALLOWED_ORIGINS` 白名单），媒体类型按 `;` 解析后精确匹配 `application/json`，chunked 写体拒绝、声明体积上限 1 MB；`SHIPPING_ALLOWED_HOSTS` / `SHIPPING_ALLOW_NO_ORIGIN` 可配置。15 项单测 + 真实 Nitro HTTP 实测；被拒请求不写隔离库。
- **A1-05/A1-07 数据兼容**：pre-S1 worktree（`f1116a5`）写隔离库（settings/关注/翻译缓存），S1 读取与重启读回一致；生产与 dev 的绝对库路径分别实测；容器路径未验证（Docker 受阻）。
- **A1-04/A1-08 浏览器与构建**：新增 `scripts/e2e-smoke.mjs`（`pnpm test:e2e`，headless Chrome + CDP），覆盖 8 路由、深链接/刷新/前进后退、设置与关注写入读回与重启读回、日历月切换与详情、零未处理错误；`pnpm dev` 与生产启动均单独验证。
- **干净环境完整安装（本地必需，已解决）**：根因是 `prebuild-install@7.1.3` 硬编码 30s 下载超时（`download.js:70`），本机官方预编译包下载约 20–40s，超时即 `unexpected end of file` 并回退 `node-gyp`（缺 VS C++ 工作负载）。用 `patches/prebuild-install@7.1.3.patch` 把超时改为可配置/180s 后，在全新 worktree（无 `node_modules`、清空预编译缓存、`--frozen-lockfile`、无 `--ignore-scripts`、无手工复制）实测安装成功，`better-sqlite3` 原生加载通过，`vite-plugin-with-nitro` 补丁自动应用。
- **Docker（不属本轮本地必需项）**：保留 `Dockerfile`/compose 配置与“未验证”真实状态；本机环境（Windows 10 Pro 19045；无 Docker/podman/nerdctl/containerd；WSL 无发行版；当前会话非管理员）不构成对本地开发的阻塞。后续采用 Docker 时再补验，不把延期写成通过。
- **服务器部署（后续待授权）**：不连接服务器、不安装服务器软件、不部署或切换服务；只有用户在本地版本可用后另行授权才考虑。
- **S1 本地范围结论**：A1-01/A1-02/A1-06/A1-07 通过；A1-05 的本地（dev/start/CLI）部分通过；A1-03/A1-04/A1-08 的 Windows 本地项通过（含干净完整安装）；Docker 未验证、不属本轮。完成审查与收尾后记录“S1 本地范围 PASS；Docker 未验证，不属于本轮交付范围”。

#### S2 first controlled real-verification batch — 2026-09-11 (written before execution)

Scope: implemented sources only, current eight ports, local isolated database. No new paid call, no unknown-fee source, no retry.

| Source | Endpoint | Type | Adapter-internal requests (cap) | Target |
|---|---|---|---|---|
| TMD official CAP | `https://www.tmd.go.th/en/api/xml/CAP` | weather-alert sync | 1 GET | TH focus ports (evidence-only association) |
| BMKG official CAP | `https://www.bmkg.go.id/alerts/nowcast/en` | weather-alert sync | 1 GET | ID focus ports (evidence-only association) |
| Shekou official notices | `https://www.portshekou.com/ywgg/` | feed sync | 1 GET (index only; no article-body fetch) | `CNSHK` |
| The Loadstar RSS | `https://theloadstar.com/feed/` | feed sync | 1 GET | general shipping news (headline/link/excerpt only) |

- Total expected external requests: **4** (one per source). No article-body fetches, no pagination.
- Disabled for this batch (no external call): GFW (non-commercial terms), Portcast (paid SaaS), Open-Meteo (non-commercial free tier), Calendarific full sync (non-commercial + 30-day cache term), VesselAPI (quota held), AIS streaming/area (off this batch), DeepSeek translation (settings disabled/budget 0), Commercial Schedule (not implemented).
- Execution: one run per Job, serial, **no automatic retry**; existing provider timeout applies. Stop the source immediately on auth/permission/rate-limit/contract change/unknown fee.
- Isolation: explicit isolated `SHIPPING_DATABASE_PATH` and test address; credentials only via the existing server-side loader; never printed, uploaded, logged or committed.
- Acceptance record per source: request/source time → persistence → Repository/API read → browser page → restart read-back → zero-Mock scan. A valid empty result yields no fabricated data.

### S2 真实数据、港口身份和覆盖矩阵

涉及：`shared/port-directory.ts`、`server/database/port-directory.ts`、现有 Provider/Runtime/Repository、`server/services/real-data-gate.ts`、`server/services/v3-readiness.ts`、`server/shipping-store.ts`、Shipping API 与页面来源显示。

实施：按八港逐项填能力矩阵，不把 Portcast 当港方公告、不把 AIS 区域估算当官方拥堵；核验港区/码头粒度与地理映射；修复已接入来源的解析/关联/显示；新增或替换来源先核验访问、用途、配额并登记决定。矩阵至少含：目标港口/字段、来源、观测/预报/衍生类型、覆盖范围、源更新时间、抓取时间、最后成功、当前状态、证据。未知值留空，页面显示未覆盖/无数据/过期/失败/未配置，不转成 0 或正常。

| ID | 验收项目 | 必须达到的结果/证据 |
| --- | --- | --- |
| A2-01 | 运行模式 | 正常业务入口明确 real；演示明确 mock；模式切换不污染库；真实库无任何模拟业务来源 |
| A2-02 | 来源完整 | 八港每项能力有真实来源或明确缺口；有名称、时间及来源性质，不只有一个绿色状态 |
| A2-03 | 港口匹配 | 别名/UNLOCODE 正确关联；歧义及 CNYPG 等未映射标识保留原值、不猜配；测试覆盖同名/粒度冲突 |
| A2-04 | 失败与时效 | 断网/403/429/超时/结构变化/正常空结果/过期分别验证；同来源 last-known 保留且标旧，不别处补位 |
| A2-05 | 阅读无副作用 | 对初始化完成、调度受控服务重复读页面/API，未触发额外 Provider 请求或 sync run；搜索例外按合同单测 |
| A2-06 | 真实闭环 | 每个纳入交付的真实适配器有授权范围内 Provider→SQLite→API→UI 证据；仅单测/历史记录不算 |
| A2-07 | 零 Mock/重启 | 对实际 schema 发现的来源业务表执行零 Mock 扫描；重启前后为 0；新增来源表也纳入，不写死表数量 |
| A2-08 | 覆盖验收 | 必需目标全满足；达不到的具体港口/字段留 BLOCKED，或由用户明确接受缩小范围 |

建议 `fix: S2 verify real data and explicit port coverage`。真实请求只在第 8 节受控环境进行。

### S3 五国年度日历官方资料与更新闭环

涉及：`docs/data-candidates/calendar/`、`server/data/annual-calendar/`、`shared/annual-calendar.ts`、`server/services/annual-calendar.ts` 及测试、`server/api/shipping/calendar/reference.get.ts`、月历组件。

实施：搜集并核对官方的年度安排及后续变更（不要求用户逐条填写）；优先复核当前 JSON 的 `sourceDocuments`，补齐缺失正文、发布日期与证据；对不适合作全国依据的使领馆/银行/转载站资料明确降级。

| 国家 | 资料核对重点（工作任务，非已完成结论） |
| --- | --- |
| TH | 年度官方主依据、后续内阁调整、全国/政府机关/金融机构/地区区别、原日期与替代休假 |
| ID | 官方年度假日及共同休假决定、后续修订、企业适用条件 |
| MY | 联邦年度表、州别表、替代日及追加公告；不能把单一州/联邦表说成全州完整 |
| PH | 年度公告及后续特别日期公告；普通假日/特别非工作日/特别工作日分别标识 |
| VN | 官方年度安排、政府/企业差异、调休/补班、条件性休假及补充公告 |

流程：读取官方资料 → 结构化候选 → 日期/来源/地区/冲突校验 → 生成差异 → 满足规则晋级年度 JSON → 构建后展示。确定、可验证、无冲突的官方条目可自动校验晋级；人工只审歧义/冲突/缺失。不引入打开网页联网抓取、自动推送主分支或旧运营日历回写。当前代码固定导入五份 2026 数据、`availableYears=[2026]`、测试固定 100 条，必须同步为与正式清单一致的年份/范围和测试契约。至少交付一个可重复运行的资料校验/差异生成入口（放现有 `scripts/` 与测试体系，命令写入本计划或 README）。来源采集失败保留旧版本并生成可核对差异，不自动提交/推送/触发 CI。

| ID | 验收项目 | 必须达到的结果/证据 |
| --- | --- | --- |
| A3-01 | 十国年格 | 2026、2027 × 五国均有资料核查状态；已公布未导入/未公布/抓取失败/范围缺失明确区分 |
| A3-02 | 每条可追溯 | 每条正式事件指向可识别 sourceDocument/原文件/链接及日期依据；不知道发布日期标未知，不编造 |
| A3-03 | 完整性核对 | 对已发布年度主表及已发现修订逐项 diff；差异有修复/适用性解释；无已知未解释漏项 |
| A3-04 | 地区与机构 | 全国/州别/政府/银行/企业条件不混用；无证据不生成港口停运事件；工作日纪念不当休假 |
| A3-05 | 日期规则 | 年份/日期有效、稳定 ID 无重复；跨月/跨年、原日期与补休/补班、条件性休假正确；同日不同事项不误去重 |
| A3-06 | 多年展示 | 正式年份能加载；未公布/未导入有提示；切国家/月份/年份/工作日筛选与来源展开可用 |
| A3-07 | 更新可重复 | 同来源输入重复执行无无意义变动；模拟官方修订只改相关记录并保留证据版本；不自动 commit/push |
| A3-08 | 边界不回归 | reference GET 不访问 Provider/运营库；不写 Calendarific 缓存、不影响 Event/HOT；G 和真实浏览器通过 |

阶段提交 `feat: S3 complete evidence-backed annual calendar updates`。只剩“提示文案”、未拿到某国主依据仍属 BLOCKED。

#### S3 阶段进展（2026-09-12）— 未 PASS

- A3 最终：A3-01～A3-08 全部 **PASS**。**S3 最终状态 `BLOCKED`——仅因 MY 2027 已公布官方文件在当前环境不可取得。** TH 2027 仅行业证据、PH Gazette 原件为 provenance enhancement，不作为 blocker。
- A3-06 冻结：仅复用 `docs/data-candidates/calendar/` → `server/data/annual-calendar/` → annual-calendar service → reference API → 现有 `/calendar` 页面；service 支持 2026/2027，有正式 JSON 返回 dataset，无正式 JSON 返回轻量 country-year 状态（`available/not_published/published_not_imported/sector_evidence_only/proposal_not_effective`）；未新增 DB/Repository/Runtime/Provider/cache/页面/第二套服务。
- A3-07：source-aware `calendar:diff`（事件含 `sourceDocumentIds` 顺序稳定与 `notesZh`/notes-only；sourceDocuments added/changed/removed；事件类型校验）；幂等、不自动 commit/push。
- 证据：PH 2026 已用 PCO/PIA 具体官方页面替换 Official Gazette 通用目录页引用，lawphil 降为镜像；source-aware diff 演示事实 0、evidence 21、source +3/-3。2026 五国 source-level diff 结果：TH/ID/MY/VN = 0/0/0，PH = 事实 0/证据 21/来源变化后晋级为 0。
- 2027：MY 官方文件未取得（`published_not_imported`，kabinet 连接超时）；TH 仅 BOT 行业证据；VN 提案未生效；ID/PH 未公布。未生成 2027 猜测 JSON。
- 真实 BLOCKED：**仅** MY 2027 已公布官方文件在当前环境不可取得（`published_not_imported / source_fetch_pending`）。TH 2027 仅行业证据、PH Gazette 签署原件为 provenance enhancement pending，A3-03/04/05/07 已满足，均不再列为 blocker。

### S4 完整原文获取、版本保存与来源追溯

涉及：现有 Feed Provider/Runtime、`server/services/`、`server/database/`、`server/database/migrations/`、`shared/` 相关类型、`server/api/shipping/feed*`、现有资讯阅读组件。新增正文能力放进已有模块，不建第二套应用。

实施：资讯发现后经受控服务端任务获取原始发布页主体，保留段落/标题/列表/表格/图注和真实来源链接，排除导航/推荐/广告/脚本。完整 HTML/可解析文档与摘要不同状态；扫描件、图片文字或暂不支持格式明确受限。对本轮来源确需的 PDF 实现文本提取及版面核对；OCR 单独标注并审核。原文版本与段落按 3.3 持久化；任务失败不阻断资讯列表，读取不当场抓取；源页面修改产生新版本，旧版本与对应译文可追溯。安全：来源 allowlist、协议/域名/解析 IP/每次重定向校验，阻断回环/私网/链路本地/云元数据；限制大小/超时/重定向/并发；不向重定向目标透传密钥；HTML 清理，禁脚本/事件属性/危险 URL；外部正文只当数据，不执行其命令/提示词；不绕过登录/付费墙/访问限制。

| ID | 验收项目 | 必须达到的结果/证据 |
| --- | --- | --- |
| A4-01 | 获取主体 | 超 10 段测试文章、长文、列表、表格、图注不被任意截断；首尾及中间结构和原文可核对 |
| A4-02 | 完整性状态 | 成功全文/只有摘要/提取不完整/需授权/暂不支持/源失效可区分；HTTP 200 本身不构成完整证据 |
| A4-03 | 来源与版本 | 原始/规范 URL、发布/抓取时间、语言、正文 hash、提取器版本可查；未知不造值；重复处理不新增重复版本 |
| A4-04 | 更新和追溯 | 修改来源一段后产生新版本；旧原文/旧译文仍对应旧版；转载和一手来源有已核实关联或明确未知 |
| A4-05 | 安全 | 重定向内网、IPv4/IPv6 特殊地址、恶意 URL、超大正文、脚本与注入指令用受控测试验证均不能越界 |
| A4-06 | 持久化 | 重启后版本与块顺序不丢；迁移在空库和 v12 副本上通过、重复执行无破坏；原数据不丢 |
| A4-07 | 读取效率 | 首页/列表只给摘要/元信息，详情才读正文；GET 不抓取/不调用模型；失败不拖垮 Feed 读取 |
| A4-08 | 实际样本 | ≥3 个允许处理的实际样本（含资讯与公告/预警）；逐块核对；缺失有明确状态；G 与浏览器通过 |

阶段提交 `feat: S4 add article versions and source traceability`。

### S5 全文分块翻译、双语阅读与费用控制

涉及：`server/services/translation-service.ts`、translation 相关服务、`server/database/translation.ts`、`server/runtime/translation-sync-job.ts`、现有 DeepSeek Provider/用量/密钥边界、`server/services/feed-translation-display.ts`、Feed API 和 `src/components/shipping/` 阅读组件。

实施：按原文版本与稳定内容块扩展翻译管线，不只翻译标题/摘要；保留原文结构；详情页提供中文、原文、逐段对照及来源/时间/版本/翻译完成状态；数字型指标展示供应商、定义、观测时间和衍生证据，不伪造可翻译文章。复用固定 DeepSeek 及当前经验证配置，不未经验证换模型或接浏览器非正式翻译端点；原文为中文时不调用模型；覆盖启用来源实际语种，不只按英文检测。术语/日期/数值/单位/坐标/船名/港名/IMO/MMSI/航次/链接受保护；模型翻译不得补写未获取段落或把正文摘要化。每块成功与用量一致；同版本/块/目标语言/模型/提示词与术语版本命中缓存不重复调用；原文变化按实际变更失效；断电后已成功块不重做；超时且供应商是否处理未知时记录“调用结果未知”，不声称未收费并无限重试。预算每次调用前检查并预留；限制输出与并发；429 按合同退避；认证/权限/合同变化保留现有熔断语义；行级失败不封锁整个 Provider；预算耗尽保留已完成译文和原文、显示部分完成，不回退成伪译文。

| ID | 验收项目 | 必须达到的结果/证据 |
| --- | --- | --- |
| A5-01 | 全文而非摘要 | 以 S4 完整版本为输入，全部必需块有结果；超 10 段、长段、表格/列表/图注不丢；结尾可核对 |
| A5-02 | “完整”判定 | 只有原文完整且全部必需块成功才标完整；如 20 块仅成功 19 块必须显示 19/20/部分完成 |
| A5-03 | 语义质量 | 审查样本无漏译/反向含义/擅自摘要/新增事实；关键数字/单位/标识自动检查全过；结构齐全不冒充语言质量 100% |
| A5-04 | 语种和对照 | 启用源语种有测试；至少实际验证英语及一种非英语来源；中文源不调模型；逐段对照能找到原块 |
| A5-05 | 缓存与版本 | 同版重复请求/并发点击/重启后阅读额外模型调用为 0；新原文版本不混旧译文；停用翻译后已成功缓存仍可读 |
| A5-06 | 恢复与预算 | 模拟中断/超时/429/认证失败/0 预算/预算耗尽；无无界重试/重复抢占；调用未知有记录；实际费用与本地估算分开 |
| A5-07 | 事实边界 | 原 Feed/数值/事件证据不变；同输入下 Event/HOT 排序与去重无翻译引入变化；GET 不即时收费 |
| A5-08 | 真实闭环 | 至少一篇授权完整长文实际翻译，保存→读取→重启→缓存回读→原文更新流程通过；来源与译文版本匹配 |
| A5-09 | 安全与可用性 | 外部正文指令不改变模型任务/工具权限；无密钥暴露；失败时原文仍可读；G 与真实浏览器交互通过 |

费用验收：先做零外部调用确定性测试；真实长文调用前确认上限（文章/字符/块数、最大请求数、token 上限、金额上限、停止条件）。无预算授权则真实部分 BLOCKED，不把 Fake Provider 成功写成 DeepSeek 真实验收。阶段提交 `feat: S5 deliver full-text translation and bilingual reading`。

### S6 商业船期数据入口与条件性实施

研究从 S0 开始，结论维护在 `docs/voyage-provider-gap.md` 和供应商矩阵，不新增研究报告。先从事先提供的业务资料确认实际承运人/起讫港；资料未提供则不按船名猜。初筛检查实际承运人官网及 Maersk、Hapag-Lloyd、CMA CGM 等官方开发者门户的船期类产品（仅候选，非确认免费/覆盖承诺）；DCSA 仅作字段/接口规范。逐个核对：数据类型、生产/样例、账户资格、费用/试用、商业使用条件、配额、目标航线与未来时间窗、更新时间、取消/变更、请求示例、失败方式；免费网页/试用套餐/永久免费 API 分开列；不为网页可打开就调用未公开接口。

**S6-A 研究与范围决定**

| ID | 必须达到的结果 |
| --- | --- |
| A6-01 | 至少对实际承运人的可用入口核对；可识别替代候选有官方证据，不用聚合营销页当确认 |
| A6-02 | 每个候选给出采用/不采用/待授权及原因，标核查日期；未确认免费不写免费 |
| A6-03 | 确定本轮目标承运人/航线/时间窗并记录是否已获可用访问；全部无入口时明确 BLOCKED |

**S6-B 条件满足后实施**（复用现有 Provider/Runtime/SQLite/API 边界，单独保存承运人计划数据与来源；不覆盖 AIS/VesselAPI ETA；不把空班/取消/改港与未知混成同一状态）

| ID | 验收项目 | 必须达到的结果/证据 |
| --- | --- | --- |
| A6-04 | 真实船期 | 至少一个已确认目标航线有承运人可核对的计划记录，非文档样例/AIS/推测挂港序列 |
| A6-05 | 身份与时间 | 船公司/船舶/服务/航次/港口/原始时区可查；未知不补造；同船不同航次不误合并 |
| A6-06 | 变化与异常 | 固定夹具覆盖 ≥2 条计划及改期/取消/空结果/过期/失败；变更有历史，失败不擦 last-known |
| A6-07 | 跨层持久化 | 数据经 Runtime→SQLite→API→页面；重启不丢；计划与实时 ETA 同屏区分来源和时间 |
| A6-08 | 预算与回归 | 配额/限流/费用受控，无自动付费升级；G、相关航次回归及浏览器验证通过 |

研究提交不冒充功能提交；实现通过标 `feat: S6 integrate approved carrier schedules`。

### S7 最终干净环境验收与知识收尾

前置：纳入交付的 S0–S6 必需项均通过；延期/覆盖限制有明确批准。

| ID | 验收项目 | 必须达到的结果/证据 |
| --- | --- | --- |
| A7-01 | 准确版本 | 受测 HEAD/树与待合并版本一致；没有测试后未验证的代码/数据改动 |
| A7-02 | 完整工程 | G 全过；新增/退役测试数量可解释；必需项没有跳过 |
| A7-03 | 平台 | Windows 启动/核心流通过；Linux 构建可在最终 CI 或后续 Linux 环境验证。**Docker/Alpine 容器验收不属本轮本地范围**，保留“未验证”状态，后续采用 Docker 时补验 |
| A7-04 | 页面/API/数据 | 第 8 节最终使用流程全部执行；真实浏览器连真实 Nitro 和隔离库，不用整站假 API |
| A7-05 | 业务数据 | 来源矩阵、五国年份格、全文状态、船期状态与真实证据一致；真实模式零 Mock 检查通过 |
| A7-06 | 数据保护 | 隔离副本的关注/设置/原文/译文/用量重启/备份恢复通过；原库和密钥未误操作 |
| A7-07 | 性能与错误 | 同环境固定数据下比较前后响应/列表/详情体积和交互；全文不进首页大载荷；无新增可重复卡顿/无限刷新 |
| A7-08 | 文档与规则 | 唯一现役计划、归档引用、README 命令、AGENTS 边界、状态、来源和验证记录一致；历史事实未改写 |
| A7-09 | 审查和收尾 | 独立审查无未解决阻塞项；真实 Neat Freak 按项目约定执行，无法执行部分明确 pending；清理只列候选 |
| A7-10 | 合并准备 | 现有 PR 含完整阶段索引、本地最终结果、已接受限制与回退步骤；尚未合并/部署；CI 静默规则仍满足 |

### S8 最终合并 CI（需单独授权）；服务器部署/实机发布为后续独立授权范围

> 本轮交付范围是 Windows 本地。S8 只到“合并 + 最终 CI”为止；**服务器部署、实机发布与线上验收不属于本轮**，列为后续待授权范围，只有用户在本地版本可用后另行明确授权才执行，且不连接服务器、不安装服务器软件、不部署或切换服务。Docker 容器检查同样保留“未验证”，后续采用 Docker 时补验。

| ID | 验收项目 | 必须达到的结果/证据 |
| --- | --- | --- |
| A8-01 | 合并范围 | 合并的正是 S7 验证内容；base 无未经验证变化；记录最终 merge SHA |
| A8-02 | CI 只在最后运行 | 最终 merge SHA 产生一个主检查 run（可多 job）；无 PR/push 双触发、旧标签发布或重复 workflow_run |
| A8-03 | CI 内容真实 | 安装/构建/类型/lint/全量测试/隔离端到端等必需 job 全部成功；不把容器检查列为本轮必需；skipped 和无 run 不算通过 |
| A8-04 | 失败不发布 | CI 失败立即停止后续；定位后本地修复并重验，不删测试或重跑碰运气 |
| A8-05 | 部署授权（后续范围） | `NOT_RUN / 后续待授权`：本轮不做发布/切换；镜像/产物、备份、数据路径与回退条件在授权后另行确认 |
| A8-06 | 实际运行（后续范围） | `NOT_RUN / 后续待授权`：本轮不做实机发布与服务切换；本地版本可用性以 S7 本地验收为准 |
| A8-07 | 结论分层 | 分别给出 merged/CI passed；deployed/live verified 若未授权则明确 `NOT_RUN / 后续待授权` 及未清理项，不写含糊“完成” |

## 7. Git 与 CI：阶段保存，最后一次合并才检查

### 7.1 分支、提交和推送

默认继续 `codex/shipping-hot-standalone-first-pass` 和 PR #1。不重生已有三个提交，不直接推 `main`，不 force-push，不擅自 rebase 他人改动。每阶段本地验证后选择性暂存已审查文件；代码、测试、必要文档一起提交；不用未经审查的 `git add .`；钩子改写文件后检查差异并重验。推送前确认暂存内容不含 `.env.*`、密钥、保留库、第三方受限全文、调试日志和临时截图。研究用 `docs`，实现用 `feat/fix/refactor`；WIP 可备份进度但不标阶段完成。

### 7.2 CI 目标配置

直接修改现有 `.github/workflows/shipping-hot-checks.yml`，不另造第二份检查文件。核心触发规则：

```yaml
name: Shipping HOT checks
on:
  push:
    branches:
      - main
permissions:
  contents: read
concurrency:
  group: shipping-hot-main
  cancel-in-progress: false
```

`main` 更新时运行，不是自动识别“最终完成”；必须配合“不直接推 main、阶段不合并、最后一个 PR 合并”的规则。一个 run 中可有 Ubuntu/Windows/容器/浏览器多个 job，不算多次阶段 CI。删除检查工作流中的 `pull_request`、`pull_request_target`、阶段分支 push、schedule、标签、无关手动触发和二次 `workflow_run` 入口；不设置排除文档路径的过滤；不采用 `[skip ci]` 作为长期策略，最终合并信息不含跳过标记。旧 `docker.yml`、`release.yml` 的自动发布/标签触发退出本轮运行链（文件退出为计划内清理，Git 历史保留，不保存旧 YAML 到杂物档案）；如仍需其有效功能，由最终检查后的独立授权发布流程承接。

### 7.3 第一次切换：避免“改 CI 的提交自己先跑一次”

1. 推送前枚举已有 workflows、触发事件、是否启用、当前运行，记录运行 ID 基线。
2. 在授权的 CI 调整范围内，先通过 GitHub UI/CLI/API 临时停用本项目相关检查和旧发布 workflow；不关闭仓库安全扫描或其他项目自动化；不取消与本轮无关的运行。
3. 本地改完 workflow 和旧入口，静态检查后提交，再推送；保留历史 run。
4. 此后阶段 push/PR 更新验证无新增 CI/发布 run；停用期间照常本地 G 和专项验收。
5. 最后一次推送、S7 通过后、**合并前**确认唯一最终检查 workflow 已重新启用、旧发布入口不会运行；启用本身不等于测试，也不补跑中途 CI。
6. 无停用/恢复权限、无法枚举全部入口或存在未知组织级强制流水线时，暂停远端推送并报告障碍；可继续本地工作，不能先推送再取消并称为“没有触发”。

### 7.4 CI 策略验收

| 动作 | 预期新增 CI/发布运行 |
| --- | --- |
| 阶段本地 commit | 0 |
| 阶段分支 push（含首次策略切换推送） | 0 |
| 草稿 PR 更新/说明/转待审 | 0 |
| 未合并关闭 PR | 0 |
| 本轮完成并合并到 main | 1 个主检查 workflow run |
| CI 失败后的修复再次合并 | 对修复准确 SHA 再执行检查 |

证据使用实际 Actions 运行列表，覆盖所有相关工作流并处理分页，记录操作前后与相应 SHA。合并由用户界面/授权执行者/能触发 `push` 的身份完成；不用另一 Actions 任务的 `GITHUB_TOKEN` 自动合并后假定必然产生下一次 CI。

### 7.5 分支保护与最终合并

先读实际 branch protection/ruleset（当前 `main` 无 protection、rulesets 为空）。若“合并前必须通过本检查”与“合并后才跑本检查”冲突，提出最小调整并取得批准，不伪造绿色状态、不管理员绕过。默认普通 merge 保留各阶段 commit，不自动压成无法对应阶段证据的 squash。`main` 有新变化时先同步并重验。

### 7.6 最终 CI 必须检查

环境（实际 Node/ABI/pnpm、锁文件**完整**安装、原生 SQLite 加载）、工程（构建生成声明、typecheck、lint、全量 Vitest、新增功能测试）、隔离端到端（构建的 Nitro + 隔离 SQLite + 真实浏览器，Provider 用受控替身、出站阻断）、Windows（环境加载/路径/原生数据库/核心流）、安全/产物（无真实秘密/测试路由/旧产品入口；产物绑定最终 SHA）、差异（对实际 before→merge SHA 做空白/变更检查）、证据（失败也保存脱敏日志/截图；不因忽略失败或 `continue-on-error` 变绿）。CI 不注入真实业务密钥、不调用付费模型/商业船期、不复用用户 `.data`。**Docker 容器检查不列为本轮本地必需 CI 项**（保留“未验证”，后续采用 Docker 时补验）；服务器部署/实机发布同样不属于本轮。

## 8. 最终测试：使用流程与隔离要求

### 8.1 先检查测试工具是否会动正式数据

`smoke:v3-real-activation` 会加载 `.env` 约定、强制 `SHIPPING_DATA_MODE=real`、默认打开 `.data/shipping-hot-v3.sqlite3` 并启动/执行已注册任务；`smoke:v3-readiness` 包装器也会初始化表、启动 Runtime。禁止在用户工作目录裸跑。执行者必须先确认独立目录无真实 `.env.*`，显式指定唯一隔离 `SHIPPING_DATABASE_PATH`，确认任务清单/执行重试上限/调用预算/来源授权，输出实际打开路径和任务列表；默认保留路径或超出授权任务出现即停止。必要时修正脚本的 fail-closed 校验，不另造可无界调用的烟雾工具。

`docker compose -p 某测试名` 不能单独保证数据卷隔离：现有配置使用固定物理卷名 `newsnow_data`。测试必须通过受控 override 将逻辑卷对应到唯一测试物理卷，并在 `docker compose config` 与实际 mount 中核对，不能复用保留卷。

### 8.2 实际使用流程验收表

| ID | 操作 | 合格结果 |
| --- | --- | --- |
| F01 | 干净检出并安装/构建/启动 | 无需遗留目录；实际进程版本/数据库路径正确；非旧 NewsNow 镜像 |
| F02 | 打开 `/`、`/vessels`、`/ports`、`/voyages`、`/feed`、`/calendar`、`/settings`、`/events` | 保留页面无卡死/空白/无限加载；console 无新增未解释错误；权限/输入错误有正确响应 |
| F03 | 按批准搜索合同检索已知船舶并关注 | 不按模糊名字误绑；关注保存，重启仍在；关联 AIS 任务符合现有订阅范围 |
| F04 | 查看有数据/无覆盖/过期/失败港口 | 四种状态不混同；来源与时间可追查；未覆盖不显示正常/0 |
| F05 | 查看资讯、展开来源、进入正文 | 原始链接/版本/提取状态可查；首页不传整个正文；来源引用关系有事实依据 |
| F06 | 打开完整长文并切换中文/原文/对照 | 段落/表格/图注对应，末尾内容存在；部分翻译有明确计数，不显示完整成功 |
| F07 | 翻译中断/0 预算/限流/重启后重复阅读 | 已完成缓存可读；无即时重复收费/无界重试；缺失原文不被 AI 补写 |
| F08 | 切换五国 2026/2027、跨月、地区和工作日筛选 | 日期/适用性/补休一致；未公布与采集缺口分开；不生成“港口必定停运” |
| F09 | 查看商业计划与当前 ETA | 两类数据来源和含义明确；已接入计划可与承运人核对；未接入不用演示计划填充 |
| F10 | 保存设置/关注/原文/译文后重启 | 核对关键行/版本/状态/用量/关注信息，不只看首页能打开 |
| F11 | 从隔离数据备份恢复到新隔离库 | 完整性检查成功、关系正确、关键数据一致；不覆盖原库 |
| F12 | 检查外部访问/跨站写入/原文恶意内容/密钥与产物 | 按 S1/S4 边界拒绝危险请求；无密钥泄露或测试路由 |
| F13 | 检查正常浏览/长文处理时的后台行为 | 读取不发起任务；页面轮询不造成重复抓取/翻译；受控后台任务不阻塞正文阅读 |
| F14 | 最终 SHA 的 Actions 和发布版本核对 | 对同一 merge SHA 所有必需 job 通过，发布后实际版本一致；不借用旧分支/旧 CI 结果 |

对无付费/外部权限的 F03/F06/F09 等可先完成离线确定性测试，但真实验收字段单列 `BLOCKED`。至少一次实际浏览器验收使用真正 Nitro 服务和隔离数据库。

### 8.3 测试数据与错误场景

固定样本至少含：真实模式零记录、单条、多来源、重复/歧义港名、未知日期、已过期资讯、显式归档/隔离资讯、超 10 段长文、结构化表格、需授权/只给摘要来源、原文更新、译文一块失败、预算不足、来源 403/429/超时、响应结构改变、数据库不可写。冻结时钟或显式传入时间验证到期边界。新增 schema/来源/内容表后补全零 Mock 与持久化检查。测试总数不要求永远 748，但必须说明“原测试 + 新增 - 有理由退役”的关系；必需检查被跳过不能通过。

### 8.4 真实请求准入表

每次真实验收前在 `docs/live-verification.md` 写入：Provider/来源、用途、样本范围、目标库、凭据来源（不含值）、最大调用数（含重试）、费用/配额上限、停止条件、授权依据。免费且无需 Key 的来源也限频；预算不明则不调用。实时接入成功、字段完整性、目标覆盖和数据新鲜度分别记结果。没有 AIS 观测可能是当次目标/接收覆盖问题，不伪造成有数据；有效空返回可证明空状态合同，不足以证明非空业务路径通过。

## 9. 回退与数据保护

- **代码回退**：每阶段保留可定位 commit。未合并问题在实施分支追加修复或明确 revert；不重写共享分支历史。合并后严重问题先冻结发布，再按授权 revert/修复并验证新的准确 SHA。禁止强推 main。
- **数据迁移**：先在空库、v12 副本与升级后副本测试，使用事务/明确失败回退，验证重复执行与重启。保留库迁移须单独批准。代码 revert 不自动等于数据库回退；旧代码对新 schema 不可安全工作时不允许直接切回旧程序写入。
- **备份恢复**：使用 SQLite 支持的一致性备份方式或受控停写副本，不把运行中单独复制主数据库文件当成已验证备份。恢复到新隔离位置，运行 `PRAGMA integrity_check` 预期 `ok`，`PRAGMA foreign_key_check` 无违规，核对关注/设置/原文版本/译文/用量及必要运营记录。
- **正式卷迁移**：不为去掉 `newsnow_data` 名字而盲目迁移。确需改名先核对现有容器 mount、备份/恢复、核对数据再切换；保留可回退原卷。不执行 `docker compose down -v`、`docker volume prune`、`git clean -fdx`。
- **原文与译文**：提取器/翻译策略变化形成新版本，历史不直接覆盖。遇源站撤回/许可变化按已批准保留政策处理，不为测试自动删除用户历史资料。
- **清场**：Neat Freak 结束后先给清理候选、归属与风险；用户看完最终报告并确认后才清理用户工作区、临时库、分支和 worktree。测试期隔离对象标唯一归属，不删除同名历史对象。

## 10. 执行后交付与汇报

`docs/status.md` 的“本轮实际结果”由执行 Agent 填回，本计划不预填通过：

| 阶段 | 预期完成标准 | 本轮实际结果 | 证据/版本 |
| --- | --- | --- | --- |
| S0 | 基线、归档承接、合同、CI 静默与基线测试通过 | 见 status 本轮记录 | status 本轮区块 |
| S1 | 独立构建/运行、访问边界和数据保留通过 | 待执行 | 现有 PR 只作输入 |
| S2 | 真实来源、八港覆盖、零 Mock 与读取边界通过 | 待执行 | 历史证据不能替代 |
| S3 | 五国两年资料状态/来源/日期/展示更新通过 | 待执行 | 当前 100 条不是新增验收 |
| S4 | 完整正文、版本、来源、安全、持久化通过 | 待执行 | — |
| S5 | 全文分块/对照、缓存恢复、预算和真实样本通过 | 待执行 | — |
| S6-A | 船期入口研究和范围决定明确 | 待执行 | 不代表 S6-B 完成 |
| S6-B | 获准计划数据接入与真实闭环通过 | 待执行 | 准入不足则 BLOCKED |
| S7 | 干净环境最终检查及知识收尾通过 | 待执行 | — |
| S8 | 最终 merge CI（授权后）；服务器部署/实机发布 | 待执行 | 合并需单独授权；部署/实机为后续独立授权，本轮 `NOT_RUN` |

最终汇报必须回答：实际改了什么；退役了哪些旧业务；哪些共享能力和数据被保留；每阶段测试和验收结果；失败与修复；覆盖缺口和经批准延期；最终分支、PR、merge SHA 与 CI 运行；数据备份恢复结果；文档维护情况；尚未执行的检查与未清理对象。本轮不发布：服务器部署/实机发布状态记 `NOT_RUN / 后续待授权`。合并前 `docs/status.md` 记录准确候选本地验收，并把“合并后 CI 结果”指向现有 PR；合并后把 merge SHA 与 CI run 补在该 PR，**不再自动提交“CI 已通过”的文档改动到 main 造成新 CI**。

总体完成条件（本地范围）：全部纳入且未获准延期的本地验收项通过、准确最终 SHA 的 CI 成功、知识收尾完成，才能称本轮本地交付完成。未授权部署不写为完成；船期或真实来源受阻必须明确部分完成。

## 11. 参考入口

- 归档 V3 计划：`docs/archive/shipping-hot-v3-real-data.md`
- 现役状态/结构：`docs/status.md`、`docs/architecture.md`、`docs/adr/`
- 供应商矩阵/船期缺口/真实验证：`docs/v3-real-provider-matrix.md`、`docs/voyage-provider-gap.md`、`docs/live-verification.md`
- 日历候选资料：`docs/data-candidates/calendar/`
- 旧 T3 历史：`docs/plans/inbox/shipping-hot-translation-t3.md`
- 外部：DCSA 商业船期规范 https://dcsa.org/standards/commercial-schedules ；AI HOT 参考说明 https://aihot.virxact.com/agent ；SQLite 在线备份 https://sqlite.org/backup.html

## 12. V3 遗留项 → 本轮承接

| V3 遗留项 | 本轮承接 |
| --- | --- |
| Voyage focus-port coverage（CNYPG 未映射） | S2 核验身份/映射；无确凿关系保留未映射，不假造 `destinationPortId` |
| Calendar official/manual completeness | S3 官方资料与年度数据闭环 |
| JMA disabled / live-pending | 本轮不自动启用；如需启用须单独授权并满足隔离探针条件 |
| Commercial Schedule entitlement-dependent | S6-A 研究；无入口则 BLOCKED，不用 AIS/ETA 冒充 |
| Public Port/Weather/Feed source-bounded coverage | S2 覆盖矩阵逐项记录，Mock 不补位 |
| Translation title/summary-only，Event/HOT translation out of scope | S4/S5 扩展为完整正文翻译；Event/HOT 翻译仍不在本轮 |
| 旧 NewsNow 业务/身份/OAuth/部署入口 | S1 按引用分析退役，保留许可与历史 |
| 100 条参考日历 / 2027 未导入 | S3 以核验结果决定，不为保持数量伪造事项 |

未采用的旧 proposal（如六国自动源迁移）保持暂停，不因 V3 归档自动激活。
