FROM node:24-bookworm-slim
WORKDIR /srv/telepaid/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY backend/src ./src
COPY backend/migrations ./migrations
COPY lib/domain /srv/telepaid/lib/domain
USER node
ENV NODE_ENV=production
CMD ["node", "src/worker.mjs"]
