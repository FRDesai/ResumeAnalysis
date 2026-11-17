# One image for every Node service (api now, worker in Phase 2).
# Pick the service with: docker build --build-arg APP=api .
FROM node:22-slim
ARG APP=api
ENV APP=${APP} NODE_ENV=production COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
USER node
CMD ["sh", "-c", "pnpm --filter @rm/${APP} start"]
