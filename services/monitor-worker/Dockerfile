FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY services/monitor-worker/package.json services/monitor-worker/package.json
RUN pnpm install --frozen-lockfile

COPY packages/shared packages/shared
COPY services/monitor-worker services/monitor-worker
RUN pnpm --filter @cloudsentinel/monitor-worker bundle:container

FROM node:24-alpine
WORKDIR /app
COPY --from=build /app/services/monitor-worker/dist-container/index.cjs /app/index.cjs
USER node
CMD ["node", "index.cjs"]
