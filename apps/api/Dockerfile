FROM node:24-alpine AS build
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/contracts/package.json packages/contracts/tsconfig.json ./packages/contracts/
COPY apps/api/package.json apps/api/tsconfig.json apps/api/tsconfig.build.json apps/api/nest-cli.json apps/api/prisma.config.ts ./apps/api/
RUN pnpm install --frozen-lockfile
COPY packages/contracts ./packages/contracts
COPY apps/api ./apps/api
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm --filter @oms/contracts build && pnpm --filter @oms/api build

FROM node:24-alpine AS runtime
WORKDIR /workspace
ENV NODE_ENV=production
RUN corepack enable && apk add --no-cache tini wget
COPY --from=build /workspace /workspace
RUN mkdir -p /data/audio && chown -R node:node /data/audio /workspace
USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["pnpm", "--filter", "@oms/api", "start:prod"]
