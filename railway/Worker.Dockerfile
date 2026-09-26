FROM debian:bookworm-slim AS vanity-build
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev libsodium-dev && rm -rf /var/lib/apt/lists/*
COPY backend/scripts/vanity-native.c /tmp/vanity.c
RUN gcc -O3 -pthread /tmp/vanity.c -lsodium -o /telepaid-vanity

FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libsodium23 && rm -rf /var/lib/apt/lists/*
COPY --from=vanity-build /telepaid-vanity /usr/local/bin/telepaid-vanity
WORKDIR /srv/telepaid/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY backend/src ./src
COPY backend/migrations ./migrations
COPY lib/domain /srv/telepaid/lib/domain
USER node
ENV NODE_ENV=production
CMD ["node", "src/worker.mjs"]
