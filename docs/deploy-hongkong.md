# 玄机 · 国内可直连部署（香港服务器）

**目标**：大陆用户不开梯子能打开。手段：把站点从 Vercel 搬到香港服务器，域名解析过去。

**为什么不是大陆服务器**：大陆节点必须 ICP 备案，而命理内容属「宣扬封建迷信」，是明确的不予备案类型。
**为什么不是国内 CDN**：CDN 同样要求域名已备案，同一条死路。
香港节点**免备案**，且腾讯云/阿里云香港轻量有 CN2 大陆优化线路，延迟约 30–60ms。

> **诚实的代价**：免备案不等于 100% 稳定。香港节点偶尔也有波动，这是不备案的固有代价。
> 比 Vercel 好一个量级，但不是大陆节点的水平。

---

## ⚠️ 先确认：你的阿里云服务器是哪个地域

**这是决定一切的一件事。**

| 地域 | 能不能用 |
|---|---|
| **香港**（`cn-hongkong`） | ✅ **免备案**，直接可用。本文就是为这个写的 |
| **大陆**（华东1/华北2/华南1…） | ❌ **不可用**。大陆节点强制要求域名已 ICP 备案，未备案域名会被阿里云拦截（解析过去也打不开）。而命理内容过不了备案 |

在阿里云控制台看实例的**地域**，或登录服务器后跑：

```bash
curl -s http://100.100.100.200/latest/meta-data/region-id
# 期望输出 cn-hongkong
```

- 输出 `cn-hongkong` → 继续往下
- 输出 `cn-hangzhou` / `cn-beijing` / `cn-shenzhen` 之类 → **停**。那台机器不能用于本方案。
  要么另买一台香港轻量（阿里云「轻量应用服务器」地域选香港，最低配约 24 元/月），
  要么回到 Vercel 硬扛。

---

## 0. 前置检查

在服务器上跑这三条，确认环境齐了：

```bash
docker --version          # 需要 20.10+
docker compose version    # 需要 v2（注意是 "docker compose"，不是 "docker-compose"）
curl -s ifconfig.me       # 记下这个公网 IP，下一步要用
```

若 `docker` 不存在：

```bash
# Ubuntu / Debian
curl -fsSL https://get.docker.com | sh

# CentOS / 腾讯云或阿里云的自带镜像
sudo yum install -y docker && sudo systemctl enable --now docker
```

---

## 1. DNS：把域名指到服务器

阿里云域名的话，在 **云解析 DNS**（控制台 → 域名 → 解析设置）加记录。
域名不在阿里云也没关系，去对应注册商加，内容一样：

| 类型 | 主机记录 | 记录值 |
|---|---|---|
| A | `@` | 你在第 0 步记下的公网 IP |
| A | `www` | 同一个 IP（可选，但建议加） |

**不要用 CNAME 指向 `cname.vercel-dns.com`** —— 那是搬到 Vercel 用的。既然要搬走，
就直指本机 IP。

**阿里云的一个细节**：如果这个域名的「解析设置」里已经有指向 Vercel 的旧记录
（可能是当初接 Vercel 时加的），**先把它们删掉或暂停**，否则两条 A 记录并存，
用户在哪个 IP 上打开是随机的 —— 表现是"一会儿能开一会儿不能"。

等 1–10 分钟生效，验证：

```bash
dig +short 你的域名
# 期望：输出第 0 步那个公网 IP
```

**这一步没验证通过就不要往下走** —— Caddy 申请 HTTPS 证书要求域名已解析到本机，
否则它会一直重试（`docker compose logs caddy` 里能看到）。

---

## 2. 放行 80 / 443

阿里云要开两处，**两处都开**：

1. **实例防火墙**（轻量应用服务器 → 防火墙；ECS → 安全组 → 入方向）
   放行 `80/tcp` 与 `443/tcp`
2. 阿里云轻量服务器默认只放行 `22`，**这一步最容易漏**
   —— 漏了的表现是域名解析对、容器起来了、但浏览器超时

系统自带的防火墙（`firewalld` / `ufw`）若也开着，同样要放行。检查：

```bash
sudo ufw status          # Ubuntu，inactive 就不用管
sudo firewall-cmd --list-all   # Alibaba Cloud Linux / CentOS
```

---

## 3. 把代码放上去

两种方式，选一种：

**A. 从 git 拉（推荐）**

```bash
sudo mkdir -p /srv && cd /srv
git clone <你的仓库地址> xuanji
cd xuanji
git checkout main        # ⚠️ 见下方「关于分支」
```

**B. 从本机传（仓库没推上去时）**

```bash
# 在你自己的电脑上，仓库根目录
tar --exclude=node_modules --exclude=.next --exclude=.git -czf xuanji.tgz .
scp xuanji.tgz root@<服务器IP>:/srv/
# 然后在服务器上
mkdir -p /srv/xuanji && tar -xzf /srv/xuanji.tgz -C /srv/xuanji
```

> **关于分支**：本文写于支付流程改造进行中。改造的全部提交在 `payment-flow` 分支上，
> `main` 还是旧的支付宝流程。**要上新的就 `git checkout payment-flow`**，
> 否则上去的是旧版。改造完成后会合回 `main`。

---

## 4. 填环境变量

```bash
cd /srv/xuanji/deploy
cp .env.production.example .env.production
nano .env.production      # 或 vim
```

要填的：

- `DOMAIN` —— **只写域名**，不带 `https://`、不带结尾斜杠
- `DEEPSEEK_API_KEY` —— 从你本机的 `.env.local` 抄
- `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` —— 同上（Supabase 项目是外部的，不随服务器搬家）
- `PASS_SECRET` —— **用与本机 `.env.local` 里同一个值**。换一个会让所有已发出的凭证失效，已经兑换过激活码的用户会突然发现权益没了

`.env.production` 里**不要**出现 `DEV_REDEEM_CODES`（那是本地后门）。

确认它不会被提交：

```bash
cd /srv/xuanji && git check-ignore -v deploy/.env.production
# 期望：打印出 .gitignore 里匹配到的那条规则
# 若什么都没有输出，说明没被忽略 —— 停下来，先补 .gitignore
```

---

## 5. Supabase 侧（一次性）

在 Supabase 项目的 SQL Editor 里，按**这个顺序**执行：

1. `supabase/schema.sql`（若该项目还没跑过）
2. `supabase/redeem.sql`
3. `supabase/orders.sql`
4. `supabase/security.sql` ← **必须最后跑**

顺序不能反：`security.sql` 开头的 `on all functions in schema` 只覆盖**它执行那一刻已存在**的函数，
先跑它会漏掉后面新建的订单函数。

体检：

```bash
cd /srv/xuanji
node --env-file=deploy/.env.production scripts/check-supabase.mjs
```

---

## 6. 起服务

```bash
cd /srv/xuanji/deploy
docker compose up -d --build
```

首次构建要几分钟（装依赖 + `next build`）。看进度：

```bash
docker compose logs -f
```

看到 Caddy 打出证书申请成功的日志就说明 HTTPS 通了。

---

## 7. 验证

```bash
# 容器都在跑
docker compose ps

# HTTPS 证书签发成功
docker compose logs caddy | grep -i "certificate obtained"

# 从服务器上打一下
curl -sI https://你的域名 | head -3
# 期望：HTTP/2 200
```

然后在**手机 4G（关掉 WiFi）**上打开 `https://你的域名` —— 这是唯一真正验证
「大陆可直连」的方法。在服务器上 curl 通不说明大陆能打开。

---

## 8. 日常运维

**更新代码**

```bash
cd /srv/xuanji && git pull
cd deploy && docker compose up -d --build
```

**看日志**

```bash
docker compose logs -f app     # 应用
docker compose logs -f caddy   # 反代与证书
```

**重启 / 停止**

```bash
docker compose restart
docker compose down            # 停（证书数据在 volume 里，不会丢）
```

**证书续期** —— 不用管，Caddy 自动做。持久化在 `caddy_data` 卷里，
所以**不要** `docker compose down -v`（`-v` 会删卷，等于删证书，下次启动会重新申请）。

---

## 9. 排错

| 现象 | 多半是 |
|---|---|
| 浏览器超时，但容器在跑 | 安全组没放行 80/443（第 2 步） |
| `dig` 出来的不是你的服务器 IP | DNS 没生效或填错了，等几分钟再试 |
| Caddy 日志一直重试申请证书 | 域名没解析到本机，或 80 端口不通（Let's Encrypt 要用 80 做验证） |
| 页面能开但样式全丢 | 构建时 `NEXT_PUBLIC_SITE_URL` 没传对；检查 `docker compose config` 里那个值 |
| 解读时报 503 | 环境变量没填全，或 Supabase 的 SQL 没跑；`docker compose logs app` 能看到具体缺哪个 |
| `git check-ignore` 没输出 | `.env.production` 会被提交，**立刻补 .gitignore 并把密钥换掉** |
| 大陆打开仍然要梯子 | 确认域名解析到的是香港 IP 而不是还指着 Vercel；`dig +short 你的域名` |

---

## 附：为什么用 Caddy 而不是 Nginx + certbot

Caddy 自己申请、自动续期、自动 http→https 跳转，配置文件只有三行（`deploy/Caddyfile`）。
Nginx 方案要写 server block、装 certbot、配 cron 续期、记得 reload —— 每多一步就多一个
半夜出问题的可能。代价只是 Caddy 的语法要另学一遍，而这里只有三行。

镜像体积也够小：多阶段构建，运行阶段只装生产依赖。
