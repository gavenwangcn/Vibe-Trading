# 构建上下文须为仓库根目录（与 docker-compose 中 context: .. 一致）：
#   docker build -f Vibe-Trading/wechat-bridge/Dockerfile ..
#
# 阶段 1：构建 @wechatbot/wechatbot（iLink SDK）
FROM node:22-bookworm-slim AS wechatbot-sdk
WORKDIR /vendor/wechatbot/nodejs
COPY wechatbot/nodejs/package.json wechatbot/nodejs/package-lock.json ./
RUN npm ci
COPY wechatbot/nodejs/ ./
RUN npm run build

# 阶段 2：微信桥
FROM node:22-bookworm-slim AS runner
WORKDIR /app

COPY Vibe-Trading/wechat-bridge/package.json Vibe-Trading/wechat-bridge/package-lock.json ./
COPY Vibe-Trading/wechat-bridge/tsconfig.json ./
COPY Vibe-Trading/wechat-bridge/src ./src

# 先放入已构建 SDK，再安装依赖（file: 指向容器内路径）
COPY --from=wechatbot-sdk /vendor/wechatbot/nodejs /vendor/wechatbot/nodejs
RUN npm pkg set dependencies.@wechatbot/wechatbot=file:/vendor/wechatbot/nodejs
RUN npm install
RUN npm run build

ENV NODE_ENV=production

RUN mkdir -p /data

CMD ["node", "dist/index.js"]
