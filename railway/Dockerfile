FROM node:24-bookworm-slim AS frontend
RUN npm install -g pnpm@11.25.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN SITES_PNPM_SHARED_STORE=/pnpm-store pnpm install --frozen-lockfile
COPY app ./app
COPY components ./components
COPY lib ./lib
COPY public ./public
COPY vendor ./vendor
COPY build ./build
COPY vps ./vps
COPY railway ./railway
COPY postcss.config.mjs tsconfig.json ./
RUN pnpm exec vite build --config railway/vite.config.ts

FROM node:24-bookworm-slim
WORKDIR /srv/telepaid/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY backend/src ./src
COPY backend/migrations ./migrations
COPY lib/domain /srv/telepaid/lib/domain
COPY --from=frontend /app/railway-dist /srv/telepaid/public
RUN mkdir -p /srv/telepaid/data/metadata && chown -R node:node /srv/telepaid/data
USER node
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/srv/telepaid/public UI_MODE=preview METADATA_DIR=/srv/telepaid/data/metadata
EXPOSE 8080
CMD ["node", "src/main.mjs"]
