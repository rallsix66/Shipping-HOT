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

- 宿主机只映射 `127.0.0.1:4444`，不直接向局域网或公网开放。旧 OAuth 配置不能当成 Shipping HOT 写接口已受到保护的证据。
- 逻辑卷名称改为 `shipping_hot_data`，但底层仍使用已有的 `newsnow_data` 卷，避免改名后读不到旧数据库。这只是数据兼容标识，不是外部镜像或服务依赖。
- 切换已有部署前，应先核对原容器的挂载位置并备份；不要运行 `docker compose down -v`。本改动没有停止或删除任何现有容器。
- 镜像不会包含本机 `.env.*`、`.data`、`.tmp` 或 `.git`。容器不会自动继承宿主机的 `.env.local`；真实供应商配置须通过未提交的 compose override / 运行环境显式注入。
- Dockerfile 的构建和运行阶段均对齐 Node `24.15.0`。本次修改未完成 Docker 构建和容器验收，不能据此宣称已可部署。

## 验证

```sh
pnpm typecheck
pnpm lint
pnpm exec vitest run -c vitest.config.ts
pnpm build
```

本分支新增 PR 质量检查，不调用付费供应商或部署生产。实际结果以对应提交的 Actions 日志为准，不继承之前提交的测试结论。

## 本轮状态

2026-09-10 的独立化首批改动仅处理部署入口和根说明，并记录后续内容目标。包元数据、其他语言 README、旧资讯业务模块、旧路由和历史部署分支尚未全部清理；根 AGENTS 与完整状态文档同步也仍待完成。详见 [独立化与内容完善工作单](docs/plans/shipping-hot-standalone-content-2026-09-10.md)。本分支不是完整清理或全量运行验收的完成证明。

## 许可证

保留 [MIT LICENSE](LICENSE) 中的上游版权与许可文本。产品名称和业务可以独立，代码来源与必要许可声明不能被抹除。
