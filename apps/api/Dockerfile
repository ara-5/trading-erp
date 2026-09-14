# Build from the monorepo root: docker build -f apps/api/Dockerfile .
# (docker-compose.yml sets this context/dockerfile pair for you.)

FROM node:22-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

# ---- full install, used for both building the app and generating the Prisma client ----
FROM base AS deps
RUN npm ci

# ---- compiled app ----
FROM deps AS build
COPY apps/api/prisma apps/api/prisma
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
COPY apps/api apps/api
RUN npm run build -w @erp/api

# ---- production-only node_modules ----
FROM base AS prod-deps
RUN npm ci --omit=dev
# The Prisma CLI needed to run `generate` is a devDependency, so the generated client comes from the
# `build` stage instead of running `generate` again against this pruned install.
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma/client ./node_modules/@prisma/client

# ---- runtime image ----
FROM node:22-alpine AS runtime
RUN addgroup -S erp && adduser -S erp -G erp
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY apps/api/package.json ./apps/api/package.json
USER erp
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["node", "dist/main.js"]
