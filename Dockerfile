# Keep the build and runtime aligned with package.json and .nvmrc.
FROM node:24.15.0-alpine AS builder
WORKDIR /usr/src
RUN apk add --no-cache python3 make g++
COPY . .
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
RUN pnpm install --frozen-lockfile
RUN pnpm run build

FROM node:24.15.0-alpine
WORKDIR /usr/app
RUN apk add --no-cache curl
COPY --from=builder /usr/src/dist/output ./output
ENV HOST=0.0.0.0 PORT=4444 NODE_ENV=production
EXPOSE 4444
CMD ["node", "output/server/index.mjs"]
