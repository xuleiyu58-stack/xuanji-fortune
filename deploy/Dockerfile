# 玄机 —— 生产镜像
#
# 为什么是普通多阶段构建而不是 Next 的 output: "standalone"：
# standalone 需要在 next.config.mjs 里加一行，而那个文件改动会影响 Vercel 的构建。
# 单台小服务器上镜像大几百 MB 无所谓，少动一处应用配置更划算。若日后要压镜像体积，
# 再开 standalone 也不迟。
#
# ⚠️ NEXT_PUBLIC_SITE_URL 必须在 **构建时** 传入，不是运行时。
# 它被 src/lib/site.ts 在模块顶层读取，用于 layout 的 metadataBase、robots.txt 与 sitemap.xml；
# 静态预渲染时这个值会被写进产物。只在运行时设，构建产物里的 canonical 与 sitemap
# 会指向 localhost —— 而这个问题在本地完全看不出来（见 site.ts 的注释）。
# docker-compose.yml 已把它作为 build args 传进来。

# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ARG NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

# 构建期不需要真实密钥：Next 只在运行时读 DEEPSEEK_API_KEY / SUPABASE_* / PASS_SECRET。
# 若构建在这里就报缺变量，说明有代码在模块顶层读了它们 —— 那是要修的问题，不是要补变量。
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# 只装生产依赖。next / react / react-dom / framer-motion / lunar-typescript /
# @supabase/supabase-js / openai 都在 dependencies 里，devDependencies 只有类型与 lint 工具。
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/next.config.mjs ./

# 不用 root 跑应用。node 镜像自带 uid 1000 的 node 用户。
USER node

EXPOSE 3000
CMD ["npm", "start"]
