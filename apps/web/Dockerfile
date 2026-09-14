# Build from the monorepo root: docker build -f apps/web/Dockerfile .
# (docker-compose.yml sets this context/dockerfile pair for you.)

FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/api/package.json apps/api/package.json

FROM base AS deps
RUN npm ci

FROM deps AS build
COPY apps/web apps/web
ENV NEXT_TELEMETRY_DISABLED=1
# The API isn't reachable at build time; only used for static generation, which doesn't need it.
ENV API_PROXY_TARGET=http://api:3001
RUN npm run build -w @erp/web

# ---- runtime image: Next's standalone server, traced from the monorepo root (see next.config.ts) ----
FROM node:22-alpine AS runtime
RUN addgroup -S erp && adduser -S erp -G erp
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER erp
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
