ARG TALLY_BASE_PATH=/
ARG NODE_IMAGE=docker.xuanyuan.run/node:24-bookworm-slim
ARG DEBIAN_MIRROR=http://mirrors.aliyun.com
ARG NPM_REGISTRY=https://registry.npmmirror.com
ARG NODE_DIST_URL=https://npmmirror.com/mirrors/node

FROM ${NODE_IMAGE} AS build

ARG DEBIAN_MIRROR
ARG NPM_REGISTRY
ARG NODE_DIST_URL
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG ALL_PROXY
ARG NO_PROXY
ENV HTTP_PROXY=$HTTP_PROXY
ENV HTTPS_PROXY=$HTTPS_PROXY
ENV ALL_PROXY=$ALL_PROXY
ENV NO_PROXY=$NO_PROXY
ENV http_proxy=$HTTP_PROXY
ENV https_proxy=$HTTPS_PROXY
ENV all_proxy=$ALL_PROXY
ENV no_proxy=$NO_PROXY
ENV NODE_USE_ENV_PROXY=1
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV COREPACK_NPM_REGISTRY=$NPM_REGISTRY
RUN sed -i "s|https\?://deb.debian.org|$DEBIAN_MIRROR|g; s|https\?://security.debian.org|$DEBIAN_MIRROR|g" /etc/apt/sources.list.d/debian.sources \
    && apt-get update \
    && apt-get install -y --no-install-recommends g++ make python3 \
    && rm -rf /var/lib/apt/lists/*
ENV npm_config_registry=$NPM_REGISTRY
ENV npm_config_disturl=$NODE_DIST_URL
ENV npm_config_proxy=$HTTP_PROXY
ENV npm_config_https_proxy=$HTTPS_PROXY
ENV npm_config_noproxy=$NO_PROXY
RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
ARG TALLY_BASE_PATH
ENV TALLY_BASE_PATH=$TALLY_BASE_PATH
RUN pnpm build && pnpm prune --prod

FROM ${NODE_IMAGE} AS runtime

ARG TALLY_BASE_PATH
ENV NODE_ENV=production
ENV NODE_USE_ENV_PROXY=1
ENV PORT=3000
ENV DATA_DIR=/app/data
ENV ACCESS_USERNAME=shrq
ENV TALLY_BASE_PATH=$TALLY_BASE_PATH

WORKDIR /app

COPY --chown=node:node --from=build /app/package.json ./package.json
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/drizzle ./drizzle
COPY --chown=node:node --from=build /app/src/server ./src/server
COPY --chown=node:node --from=build /app/src/shared ./src/shared

RUN mkdir -p /app/data && chown node:node /app/data

USER node

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["./node_modules/.bin/tsx", "src/server/index.ts"]
