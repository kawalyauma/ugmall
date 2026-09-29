# syntax=docker/dockerfile:1.7
# Builds either Next.js app: --build-arg APP=storefront|admin
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /repo

FROM base AS build
ARG APP
ARG NEXT_PUBLIC_GA_MEASUREMENT_ID
ARG NEXT_PUBLIC_META_PIXEL_ID
ENV NEXT_PUBLIC_GA_MEASUREMENT_ID=${NEXT_PUBLIC_GA_MEASUREMENT_ID}
ENV NEXT_PUBLIC_META_PIXEL_ID=${NEXT_PUBLIC_META_PIXEL_ID}
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc ./
COPY apps/${APP}/package.json apps/${APP}/
COPY packages/shared ./packages/shared
# Optional corporate/intercepting-proxy CA: --secret id=ca,src=/path/ca.crt
RUN --mount=type=cache,id=pnpm,target=/pnpm/store --mount=type=secret,id=ca,required=false \
    NODE_EXTRA_CA_CERTS=$( [ -f /run/secrets/ca ] && echo /run/secrets/ca ) pnpm install --frozen-lockfile --filter @ugmall/${APP}...
COPY apps/${APP} ./apps/${APP}
RUN pnpm --filter @ugmall/${APP} build

FROM node:22-bookworm-slim AS runtime
ARG APP
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/${APP}/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/${APP}/.next/static ./apps/${APP}/.next/static
COPY --from=build --chown=node:node /repo/apps/${APP}/public ./apps/${APP}/public
ENV APP_DIR=apps/${APP}
USER node
EXPOSE 3000
CMD ["sh", "-c", "node $APP_DIR/server.js"]
