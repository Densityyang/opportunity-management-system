FROM node:24-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/tsconfig.json ./packages/contracts/
COPY apps/web/package.json apps/web/tsconfig.json apps/web/tsconfig.app.json apps/web/tsconfig.node.json apps/web/vite.config.ts ./apps/web/
RUN pnpm install --frozen-lockfile
COPY packages/contracts ./packages/contracts
COPY apps/web ./apps/web
RUN pnpm --filter @oms/contracts build && pnpm --filter @oms/web build

FROM nginx:1.27-alpine
COPY infra/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 80
