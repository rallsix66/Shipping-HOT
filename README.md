# Shipping HOT

面向中国至东南亚航运工作的本地信息看板：聚合船舶动态、港口情报、天气预警、航运资讯和年度参考日历。

技术底座保持 Vite + React + Nitro + db0 / SQLite，不更换框架。功能与历史验证以 [docs/status.md](docs/status.md) 为准，系统边界见 [docs/architecture.md](docs/architecture.md)。

## 当前能力与限制

- 船舶检索、AIS 跟踪、港口与天气、公共资讯接入已有实现及历史验证记录；不能将历史验证当作本机当前服务状态。
- 默认使用 Mock 演示数据。Real 模式必须显式配置相应供应商和密钥；无数据不能以模拟数据冒充真实结果。
- 港口目录和公共来源覆盖有限，商业船期尚无已确认授权的数据入口。AIS 位置与预计到达时间不能代替承运人公布的船期。
- `/calendar` 当前展示五国 2026 年固定参考数据，存在地区与主依据缺口；2027 年尚未导入。
- 当前自动翻译范围是资讯标题与摘要。完整原文提取、全文翻译和逐段追溯是新增目标，尚未实现。

## 本地运行

使用项目固定工具链：Node.js `24.15.0`、pnpm `10.30.3`。不要跨 Node 版本或操作系统复用 `node_modules` 中的原生 SQLite 模块。

```sh
corepack enable
corepack prepare pnpm@10.30.3 --activate
pnpm install --frozen-lockfile
pnpm dev
```

非敏感服务端配置使用 `.env.server`，本机覆盖与密钥使用 `.env.local`，均不得提交。开发与 `pnpm start` 的环境优先级为 `process env > .env.local > .env.server > code defaults`。生产方式本地运行先执行 `pnpm build`，再执行 `pnpm start`。

## Docker：构建本仓库，不拉取其他项目镜像

本分支修改后的两个 compose 入口均构建当前 Shipping HOT 源码，使用本地镜像 `shipping-hot:local`。

```sh
docker compose up --build
```

本地兼容入口为 `docker compose -f docker-compose.local.yml up --build`。不要同时启动两个入口占用同一个端口。

- 宿主机只映射 `127.0.0.1:4444`，不直接向局域网或公网开放。服务端已移除旧 GitHub OAuth/JWT 登录，改为回环 Host/Origin 与请求方法/类型/体积校验的本地访问边界；这不是完整用户鉴权，不能据此把服务暴露到公网。
- 逻辑卷名称改为 `shipping_hot_data`，但底层仍使用已有的 `newsnow_data` 卷，避免改名后读不到旧数据库。这只是数据兼容标识，不是外部镜像或服务依赖。
- 切换已有部署前，应先核对原容器的挂载位置并备份；不要运行 `docker compose down -v`。本改动没有停止或删除任何现有容器。
- 镜像不会包含本机 `.env.*`、`.data`、`.tmp` 或 `.git`。容器不会自动继承宿主机的 `.env.local`；真实供应商配置须通过未提交的 compose override / 运行环境显式注入。
- Dockerfile 的构建和运行阶段均对齐 Node `24.15.0`。本机当前未安装 Docker CLI，Docker 构建/容器验收按实际记录为受阻，不能据此宣称已完成容器验收或可部署。

## 验证

全新检出需先生成 Nitro 声明：`tsconfig.node.json` 包含 `dist/.nitro/types`，直接在没有该目录的环境运行 TypeScript 会缺少自动导入声明。

```sh
pnpm build
pnpm typecheck
pnpm lint
pnpm exec vitest run -c vitest.config.ts
```

阶段验收在本地执行（CI 在本轮保持静默，只有最终合并到 `main` 才运行唯一检查工作流）。真实 Provider、付费翻译与发布相关验收分别归入后续阶段，未获授权前不执行。

## 本轮状态

S1 已完成产品独立化与旧资讯业务退役：移除 NewsNow 资讯源、旧资讯路由、OAuth/用户同步与旧缓存模块，改为仅保留 Shipping HOT 的 `shipping/**` 路由、SQLite 底座和共享工具；包名、PWA/页面元数据与图标改用 Shipping HOT 身份；旧 Cloudflare/Vercel/Bun 部署入口退出。`newsnow_data` 物理卷、留存的旧 `user` 表数据和 MIT 许可未被删除。旧资讯业务与内容完善（真实数据、日历、全文翻译、商业船期）仍按计划在 S2–S6 推进。详见 [独立化与内容完善工作单](docs/plans/shipping-hot-standalone-content-2026-09-10.md)。

## 许可证

保留 [MIT LICENSE](LICENSE) 中的上游版权与许可文本。产品名称和业务可以独立，代码来源与必要许可声明不能被抹除。
