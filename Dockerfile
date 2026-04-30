# ---- 构建阶段：装依赖 + 编译 better-sqlite3 native binding ----
FROM node:20-alpine AS deps

WORKDIR /app

# better-sqlite3 需要 native 编译
RUN apk add --no-cache python3 make g++ libc6-compat

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- 运行阶段：精简镜像 ----
FROM node:20-alpine

WORKDIR /app

# 时区（China）；按需改 / 删
RUN apk add --no-cache tzdata && \
    cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime && \
    echo "Asia/Shanghai" > /etc/timezone && \
    apk del tzdata

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY server.js tts-bigtts.js ./
COPY public ./public
COPY config ./config

# data 目录用 volume 挂出来；启动时如果不存在就创建
RUN mkdir -p data && chown -R node:node /app

USER node

EXPOSE 3001

ENV NODE_ENV=production
ENV PORT=3001

# 健康检查（Docker 自带的，方便 swarm/k8s 用）
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --quiet --tries=1 --spider http://127.0.0.1:3001/ || exit 1

CMD ["node", "server.js"]
