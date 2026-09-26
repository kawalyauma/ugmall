# syntax=docker/dockerfile:1.7
# API + background worker (same image, different command).
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY packages ./packages
# Optional corporate/intercepting-proxy CA: --secret id=ca,src=/path/ca.crt
RUN --mount=type=cache,id=pnpm,target=/pnpm/store --mount=type=secret,id=ca,required=false \
    NODE_EXTRA_CA_CERTS=$( [ -f /run/secrets/ca ] && echo /run/secrets/ca ) pnpm install --frozen-lockfile --filter @ugmall/api...
COPY apps/api ./apps/api
RUN --mount=type=cache,id=pnpm,target=/pnpm/store --mount=type=secret,id=ca,required=false \
    export NODE_EXTRA_CA_CERTS=$( [ -f /run/secrets/ca ] && echo /run/secrets/ca ) \
 && pnpm --filter @ugmall/api build \
 && pnpm --filter @ugmall/api deploy --prod --legacy /out \
 && cp -r apps/api/dist /out/dist \
 && cp -r packages/database/migrations /out/migrations \
 && cp -r packages/delivery/data /out/data

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production MIGRATIONS_DIR=/app/migrations STORAGE_ROOT=/storage LOCATIONS_DATA=/app/data/uganda-locations.json.gz
RUN mkdir -p /storage && chown node:node /storage
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s CMD ["node", "-e", "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/server.js"]
