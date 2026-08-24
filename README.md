![](/public/og-image.png)

English | [简体中文](README.zh-CN.md) | [日本語](README.ja-JP.md)

> [!NOTE]
> This is a demo version currently supporting Chinese only. A full-featured version with better customization and English content support will be released later.

**_Elegant reading of real-time and hottest news_**

## Features

- Clean and elegant UI design for optimal reading experience
- Real-time updates on trending news
- GitHub OAuth login with data synchronization
- 30-minute default cache duration (logged-in users can force refresh)
- Adaptive scraping interval (minimum 2 minutes) based on source update frequency to optimize resource usage and prevent IP bans
- support MCP server

```json
{
  "mcpServers": {
    "newsnow": {
      "command": "npx",
      "args": [
        "-y",
        "newsnow-mcp-server"
      ],
      "env": {
        "BASE_URL": "https://newsnow.busiyi.world"
      }
    }
  }
}
```
You can change the `BASE_URL` to your own domain.

## Deployment

### Basic Deployment

For deployments without login and caching:

1. Fork this repository
2. Import to platforms like Cloudflare Page or Vercel

### Cloudflare Page Configuration

- Build command: `pnpm run build`
- Output directory: `dist/output/public`

### GitHub OAuth Setup

1. [Create a GitHub App](https://github.com/settings/applications/new)
2. No special permissions required
3. Set callback URL to: `https://your-domain.com/api/oauth/github` (replace `your-domain` with your actual domain)
4. Obtain Client ID and Client Secret

### Environment Variables

Refer to `example.env.server`. For local development, rename it to `.env.server` and configure:

```env
# Github Client ID
G_CLIENT_ID=
# Github Client Secret
G_CLIENT_SECRET=
# JWT Secret, usually the same as Client Secret
JWT_SECRET=
# Initialize database, must be set to true on first run, can be turned off afterward
INIT_TABLE=true
# Whether to enable cache
ENABLE_CACHE=true
```

Shipping HOT local environment contract:

1. Copy `example.env.server` to `.env.server` for durable non-secret server configuration and safe Mock/Off defaults.
2. Put local secrets or Real Mode overrides in `.env.local`; `.env.local` overrides `.env.server`, while explicit process environment variables have the highest priority.
3. `.env` and `.env.*` are ignored by Git; never commit secrets.
4. `pnpm dev` and `pnpm start` use the same precedence: `process env > .env.local > .env.server > code defaults`.
5. To run the local Nitro production server, run `pnpm build` first and then `pnpm start`.

### Database Support

Supported database connectors: https://db0.unjs.io/connectors
**Cloudflare D1 Database** is recommended.

1. Create D1 database in Cloudflare Worker dashboard
2. Configure database_id and database_name in wrangler.toml
3. If wrangler.toml doesn't exist, rename example.wrangler.toml and modify configurations
4. Changes will take effect on next deployment

### Docker Deployment

In project root directory:

```sh
docker compose up
```

You can also set Environment Variables in `docker-compose.yml`.

## Shipping HOT (Local Implementation)

This repository carries a local **Shipping HOT** implementation on top of the NewsNow foundation. Accepted V3 phases — P0 Persistence, P1A Port Directory Foundation, P1B Mock Isolation, P2A Search Foundation, P2B Identity Seal, P2C Background Runtime Foundation, P3A AIS Tracking Runtime Foundation and P3B Voyage / ETA Foundation — are implemented and locally verified on the pinned Node `24.15.0` / SQLite baseline (`.data/shipping-hot-v3.sqlite3`).

- Safe defaults: Mock providers everywhere; real providers stay key/adapter-gated.
- Pending / deferred: Information Feed auto sync, Calendar auto sync, Translation, real Voyage adapter coverage and live AIS observation.
- Current status: see [`docs/status.md`](docs/status.md); architecture: [`docs/architecture.md`](docs/architecture.md); V3 plan: [`docs/plans/shipping-hot-v3-real-data.md`](docs/plans/shipping-hot-v3-real-data.md).

## Development

> [!Note]
> Requires the pinned Node.js `24.15.0` toolchain (`engines` / `.nvmrc`; ABI `137` for `better-sqlite3`)

```sh
corepack enable
pnpm i
pnpm dev
```

### Adding Data Sources

Refer to `shared/sources` and `server/sources` directories. The project provides complete type definitions and a clean architecture.

For detailed instructions on how to add new sources, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Roadmap

- Add **multi-language support** (English, Chinese, more to come).
- Improve **personalization options** (category-based news, saved preferences).
- Expand **data sources** to cover global news in multiple languages.

**_release when ready_**
![](https://testmnbbs.oss-cn-zhangjiakou.aliyuncs.com/pic/20250328172146_rec_.gif?x-oss-process=base_webp)

## Contributing

~~Contributions are welcome! Feel free to submit pull requests or create issues for feature requests and bug reports.~~

The new version is coming soon and we will no longer accept contributions

~~See [CONTRIBUTING.md](CONTRIBUTING.md) for detailed guidelines on how to contribute, especially for adding new data sources.~~

## License

[MIT](./LICENSE) © ourongxing

## Sponsorship

If you rely on this service, sponsorship is welcome to help it run for the long term. If you need customization or other help, you can also use the contact method below and include a note.

![](./screenshots/reward.gif)
