# 本仓库（自建 Fork）云服务器自动部署指南

> **给 AI / 自动化 Agent**  
> 1. 只部署 **本仓库源码构建**，**禁止**官方镜像 `neosmemo/memos:*`（无导航/TTS/审计等）。  
> 2. **默认按中国大陆网络环境执行**（§1.4 先配加速，再 clone / pnpm / docker build）。  
> 3. 无人值守；需人类决策时用文中默认值，结束时汇报「已采用的默认值」与「建议人工复核项」。

---

## 0. 部署目标

| 项 | 值 |
| --- | --- |
| 应用 | 本 fork（Go + 内嵌前端） |
| 方式 | Docker 源码构建 `scripts/Dockerfile` |
| 镜像 | `memos:<git短哈希>`（本地构建） |
| 端口 | `5230`（`MEMOS_HOST_PORT`） |
| 数据 | `./data` → `/var/opt/memos` |
| 重启 | `unless-stopped` |

构建阶段会拉取：`golang:1.27.0-alpine`、`alpine:3.21`，并下载 Go modules、npm 包。  
**国内服务器若不配加速，几乎必然失败或极慢。**

---

## 1. 前置与国内网络加速（先做这一步）

### 1.1 硬件与软件检查

```bash
uname -m                          # x86_64 / aarch64
docker --version && docker compose version
git --version
node --version                    # ≥20
pnpm --version || true
free -h | head -2                 # 构建建议 ≥2GB
df -h / | tail -1                 # 建议 ≥15GB
```

### 1.2 安装 Docker（若无）

国内 `get.docker.com` 可能慢，二选一：

```bash
# A) 官方脚本（网络通畅时）
curl -fsSL https://get.docker.com | sh

# B) 阿里云镜像（推荐国内）
curl -fsSL https://get.docker.com | sh -s -- --mirror Aliyun

sudo usermod -aG docker "$USER"
# 重新登录 shell
docker run --rm hello-world || echo "hello-world 可能拉不到，见 1.4 加速后重试"
```

### 1.3 安装 Node / pnpm（若无）

```bash
# 方式 A：NodeSource（国内可能慢）
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 方式 B：国内二进制（推荐）
NODE_VER=v22.11.0
ARCH=$(uname -m); case $ARCH in x86_64) NARCH=x64;; aarch64) NARCH=arm64;; *) echo "unsupported $ARCH"; exit 1;; esac
curl -fsSL "https://cdn.npmmirror.com/binaries/node/${NODE_VER}/node-${NODE_VER}-linux-${NARCH}.tar.xz" -o /tmp/node.tar.xz
sudo tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1
node -v

# pnpm（走 npmmirror）
npm config set registry https://registry.npmmirror.com
npm i -g pnpm@latest --registry=https://registry.npmmirror.com
pnpm -v
```

### 1.4 国内加速（**部署中国服务器时必须执行**）

#### Docker 镜像加速

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://dockerproxy.net",
    "https://docker.1ms.run",
    "https://mirror.ccs.tencentyun.com"
  ]
}
EOF
sudo systemctl restart docker
# 验证能否拉基础镜像（约 30MB+）
docker pull alpine:3.21
```

说明：

- 腾讯云主机可用 `mirror.ccs.tencentyun.com`（仅内网加速，外网无效）。
- 阿里云 ECS 可用控制台镜像加速器地址。
- 镜像源列表可能失效；失败就换源里的其它 URL 再 `docker pull golang:1.27.0-alpine`。

#### Go 模块

```bash
export GOPROXY=https://goproxy.cn,direct
# 备用: https://goproxy.io,direct  或  https://mirrors.aliyun.com/goproxy/,direct
```

已写入 `deploy/.env.example` 的 `GOPROXY=`，compose 会传给 `docker build`。

#### npm / pnpm

```bash
npm config set registry https://registry.npmmirror.com
pnpm config set registry https://registry.npmmirror.com
export npm_config_registry=https://registry.npmmirror.com
```

#### GitHub（clone 失败时）

```bash
# A) 优先：本地 rsync / scp 上传（最稳，见 §2.2）
# B) 代理（若有）
# export https_proxy=http://127.0.0.1:7890
# C) 镜像前缀 clone（可用性随时间变化，失败则用 A）
# git clone --depth 1 https://ghproxy.net/https://github.com/GZY-q/memos.git /opt/memos/src
```

### 1.5 自检（全部应成功）

```bash
docker pull alpine:3.21
docker pull golang:1.27.0-alpine
curl -fsSI https://goproxy.cn | head -1
curl -fsSI https://registry.npmmirror.com | head -1
```

任一失败 → 先修加速，再进入 §2。

---

## 2. 获取本仓库源码

**必须是本 fork**，不要 clone 上游 `usememos/memos`。

### 2.1 git clone（GitHub 可达时）

```bash
REPO_URL="${REPO_URL:-https://github.com/GZY-q/memos.git}"
REPO_DIR="${REPO_DIR:-/opt/memos/src}"
export GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"

mkdir -p "$(dirname "$REPO_DIR")"
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" fetch --depth 1 origin
  git -C "$REPO_DIR" checkout -B deploy origin/HEAD || git -C "$REPO_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR" && git log -1 --oneline
```

### 2.2 rsync / scp 上传（**国内推荐**，不依赖 GitHub）

在**本机**（已 clone 好代码的电脑）执行：

```bash
# 在 /Users/gede/github/memos 或你的仓库根目录
rsync -az --delete \
  --exclude .git \
  --exclude web/node_modules \
  --exclude deploy/data \
  --exclude server/router/frontend/dist \
  ./ user@服务器IP:/opt/memos/src/
```

或打包上传：

```bash
tar czf /tmp/memos-src.tgz --exclude .git --exclude web/node_modules --exclude deploy/data .
scp /tmp/memos-src.tgz user@server:/tmp/
ssh user@server 'mkdir -p /opt/memos/src && tar xzf /tmp/memos-src.tgz -C /opt/memos/src'
```

### 2.3 完整性检查

```bash
cd "${REPO_DIR:-/opt/memos/src}"
test -f scripts/Dockerfile || { echo "FATAL: 缺少 scripts/Dockerfile"; exit 1; }
test -f deploy/docker-compose.build.yml || { echo "FATAL: 缺少 compose"; exit 1; }
test -f web/package.json || { echo "FATAL: 缺少 web/"; exit 1; }
```

---

## 3. 构建前端（镜像前必做）

Docker **不会**编 `web/`（`.dockerignore` 排除），必须先 `pnpm release`。

```bash
cd "${REPO_DIR:-/opt/memos/src}/web"

# 强制国内 registry
npm config set registry https://registry.npmmirror.com
pnpm config set registry https://registry.npmmirror.com

pnpm install --frozen-lockfile || pnpm install
pnpm release

test -f "$REPO_DIR/server/router/frontend/dist/index.html" || \
  test -f ../server/router/frontend/dist/index.html || {
  echo "FATAL: pnpm release 未生成 dist/index.html"
  exit 1
}
```

失败排查：

| 错误 | 处理 |
| --- | --- |
| ETIMEDOUT / ECONNRESET | 确认 registry 为 npmmirror；换网络重试 |
| pnpm: command not found | §1.3 安装 pnpm |
| node 版本过低 | 使用 Node 20/22 |

跳过本步 → 容器**白屏**。

---

## 4. 构建并启动容器

```bash
cd "${REPO_DIR:-/opt/memos/src}/deploy"
cp -n .env.example .env

GIT_COMMIT=$(git -C "${REPO_DIR:-/opt/memos/src}" rev-parse --short HEAD 2>/dev/null || echo dev)
{
  echo "MEMOS_VERSION=${GIT_COMMIT}"
  echo "MEMOS_COMMIT=${GIT_COMMIT}"
  grep -q '^GOPROXY=' .env || echo "GOPROXY=https://goproxy.cn,direct"
} >> .env

mkdir -p data

# 环境变量也会被 compose 传入 build args
export GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"

docker compose -f docker-compose.build.yml up -d --build
```

### 4.1 构建失败备用命令

```bash
cd "${REPO_DIR:-/opt/memos/src}"
export GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo dev)

docker build -f scripts/Dockerfile \
  -t "memos:${GIT_COMMIT}" \
  --build-arg VERSION="${GIT_COMMIT}" \
  --build-arg COMMIT="${GIT_COMMIT}" \
  --build-arg GOPROXY="${GOPROXY}" \
  .

docker rm -f memos 2>/dev/null || true
docker run -d --name memos --restart unless-stopped \
  -p "${MEMOS_HOST_PORT:-5230}:5230" \
  -v "$PWD/deploy/data:/var/opt/memos" \
  -e TZ="${TZ:-Asia/Shanghai}" \
  "memos:${GIT_COMMIT}"
```

数据目录权限：`sudo chown -R 10001:10001 deploy/data`（容器内 nonroot）。

### 4.2 构建期常见网络错误

| 日志 | 处理 |
| --- | --- |
| `pull access denied` / timeout 拉 `golang:1.27.0-alpine` | §1.4 换 registry-mirrors 后重试 |
| `dial tcp: i/o timeout` on `proxy.golang.org` | 确保 build-arg `GOPROXY=https://goproxy.cn,direct` |
| apk 超时（alpine 包） | 稍后重试；或换可访问外网的构建机再 `docker save/load` |
| github.com clone during go mod | goproxy.cn 可代理大部分模块；必要时 `GOPRIVATE`/代理 |

---

## 5. 验证（必须）

```bash
docker ps --filter name=memos --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
docker logs memos --tail 80
curl -fsS http://127.0.0.1:5230/healthz    # Service ready.
curl -fsS -o /dev/null -w "root %{http_code}\n" http://127.0.0.1:5230/
docker inspect memos --format '{{.Config.Image}}'
```

| 检查 | 期望 |
| --- | --- |
| Image | `memos:<commit>`，**不是** `neosmemo/memos` |
| healthz | 200 |
| 浏览器 | 有导航 / 日记；设置有审计、导入 |

### 5.1 防火墙 / 安全组

```bash
sudo ufw allow 22/tcp
sudo ufw allow 5230/tcp    # 调试；生产仅 80/443 + 反代
sudo ufw enable
```

云控制台安全组同步放行。

---

## 6. HTTPS 反代（生产）

端口改仅本机后重启 compose：

```yaml
ports:
  - "127.0.0.1:5230:5230"
```

Caddy / Nginx 反代 `127.0.0.1:5230`。Nginx 需传 `Host`、`X-Forwarded-Proto`，并为 SSE 配置 `Upgrade` 与长超时。DNS `A` 记录指向服务器 IP。

国内申请证书：确保 80 端口可被 Let’s Encrypt 访问，或使用 DNS-01。

---

## 7. 备份与升级

```bash
# 备份
cd /opt/memos/src/deploy
docker compose -f docker-compose.build.yml stop
tar czf "/backup/memos-$(date +%F).tar.gz" data
docker compose -f docker-compose.build.yml start

# 升级（rsync 或 git 拉新代码后）
cd /opt/memos/src/web && pnpm install && pnpm release && cd ..
cd ../deploy
export GOPROXY=https://goproxy.cn,direct
docker compose -f docker-compose.build.yml up -d --build
```

---

## 8. 故障排查（含国内特有）

| 症状 | 处理 |
| --- | --- |
| 白屏 / 无 fork 功能 | 未 `pnpm release` 或 dist 为空（§3） |
| `docker pull` 卡住 | 换 registry-mirrors；云厂商内网加速 |
| `go mod download` 超时 | `--build-arg GOPROXY=https://goproxy.cn,direct` |
| `pnpm install` 超时 | registry.npmmirror.com |
| `git clone` GitHub 失败 | rsync 上传（§2.2） |
| 端口占用 | 改 `MEMOS_HOST_PORT` |
| data 权限 | `chown -R 10001:10001 deploy/data` |
| 误用官方镜像 | `docker rm -f memos`，用 `docker-compose.build.yml` 重建 |

---

## 9. AI 收尾报告模板

```markdown
## 自建 Fork 部署完成

- 源码：/opt/memos/src（commit: <hash>，来源：git/rsync）
- 镜像：memos:<hash>（本地构建，非 neosmemo/memos）
- 网络：已配置 Docker 加速 + GOPROXY=goproxy.cn + npmmirror
- 地址：http(s)://...
- 数据：/opt/memos/src/deploy/data
- healthz：200
- fork 功能抽查：导航/日记/审计/导入 — 通过/未测

### 默认决策
- 端口 5230、TZ Asia/Shanghai、SQLite、国内加速默认开启

### 人工复核
- [ ] 安全组最小端口
- [ ] 定期备份 data/
- [ ] HTTPS
- [ ] Host 强密码
```

---

## 10. 一页速查（国内服务器，整段给 AI）

```text
在中国大陆云服务器部署我的 Memos fork（禁止 neosmemo/memos 官方镜像）：

1) 配置 Docker registry-mirrors、GOPROXY=https://goproxy.cn,direct、
   npm/pnpm registry=https://registry.npmmirror.com
2) 安装 Docker + Node20/22 + pnpm（国内源）
3) 获取源码：优先 rsync/scp 上传仓库到 /opt/memos/src；GitHub 可达再 git clone
4) cd /opt/memos/src/web && pnpm install && pnpm release   # 必须
5) cd /opt/memos/src/deploy && cp .env.example .env
   # .env 含 GOPROXY=https://goproxy.cn,direct
6) docker compose -f docker-compose.build.yml up -d --build
7) curl http://127.0.0.1:5230/healthz 必须 200
8) 确认镜像为本地 memos:<hash>，侧栏有导航/日记
9) 汇报 commit、URL、数据路径、加速配置与安全组建议
```

---

## 相关文件

| 文件 | 说明 |
| --- | --- |
| `deploy/docker-compose.build.yml` | 本 fork 构建 compose（含 GOPROXY build arg） |
| `deploy/.env.example` | 含国内 GOPROXY 默认值 |
| `scripts/Dockerfile` | 支持 `ARG GOPROXY` |
| `deploy/DEPLOY.md` | 简版说明 |
