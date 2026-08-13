# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24.14.1

FROM node:${NODE_VERSION}-bookworm-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json ./
COPY config ./config
COPY scripts ./scripts
COPY src ./src

RUN npm run build \
  && npm prune --omit=dev

FROM node:${NODE_VERSION}-bookworm-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates gosu tini \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /app/database \
  && chown node:node /app/database

COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/src/web/public ./src/web/public
COPY docker-entrypoint.sh /usr/local/bin/dyoor-entrypoint

RUN chmod 0755 /usr/local/bin/dyoor-entrypoint

EXPOSE 3100

ENTRYPOINT ["tini", "--", "/usr/local/bin/dyoor-entrypoint"]
CMD ["node", "dist/src/index.js"]
