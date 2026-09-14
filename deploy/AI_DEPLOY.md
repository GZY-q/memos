# Memos Fork — AI 云服务器自动部署指南

> **给 AI 的说明**：本文按「可无人值守执行」编写。按顺序执行步骤，不要跳过前置检查。遇到需要人类决策的地方（域名、端口、是否用 HTTPS），使用文中默认值，并在结束时列出「已采用的默认值」与「建议人工复核项」。

---

## 0. 目标与产物

在一台 Linux 云服务器上部署本仓库（GZY-q/memos fork）或官方 Memos：

| 产物 | 说明 |
| --- | --- |
| Web UI | `http://<host>:5230` 或 `https://<domain>` |
| 数据目录 | `./data`（SQLite `memos_prod.db` + 附件） |
| 进程 | Docker 容器 `memos`，`restart: unless-stopped` |

**本 fork 额外能力**（源码构建才有）：导航页、TTS、审计、FTS、导出、日记、导入等。  
若只需上游功能，可用官方镜像 `neosmemo/memos:stable`。

---

## 1. 前置检查（必须）

在服务器上执行并记录输出：

```bash
uname -m                    # 期望 x86_64 或 aarch64
cat /etc/os-release | head -2
free -h | head -2           # 建议 ≥1GB RAM
df -h / | tail -1           # 建议 ≥10GB 可用
docker --version            # 必须
docker compose version      # 必须（或 docker-compose）
git --version               # 源码构建需要
curl --version | head -1
```

### 1.1 若无 Docker

```bash
# Debian/Ubuntu
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
# 重新登录 shell 后验证
docker run --rm hello-world
```

### 1.2 国内网络（可选）

若 `docker pull` / `go mod` 极慢，配置镜像加速（示例，按发行版调整）：

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json >/dev/null <<'EOF'
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://mirror.ccs.tencentyun.com"
  ]
}
EOF
sudo systemctl restart docker
```

Go 模块可在构建环境设置：

```bash
export GOPROXY=https://goproxy.cn,direct
```

---

## 2. 选择部署模式（AI 决策树）

```
用户是否要求「这个 fork / 导航 / TTS / 审计」功能？
├─ 是 → 模式 B：源码构建
└─ 否，只要快速可用 Memos → 模式 A：官方镜像
用户是否已提供域名并要求 HTTPS？
├─ 是 → 步骤 6 反代 + 端口只绑 127.0.0.1
└─ 否 → 直接暴露 5230（或 MEMOS_HOST_PORT），并在总结中提醒「生产建议 HTTPS」
```

**默认**：无明确说明时用 **模式 B（源码构建）**，因为本仓库是 fork。

---

## 3. 模式 A — 官方镜像（最快，无 fork 特性）

```bash
mkdir -p /opt/memos/deploy && cd /opt/memos/deploy

# 若能访问本仓库，直接拷贝 deploy 文件；否则手写 compose（见下）
# curl 本仓库 raw 或 git clone --depth 1

cat > docker-compose.yml <<'YAML'
services:
  memos:
    image: neosmemo/memos:stable
    container_name: memos
    restart: unless-stopped
    ports:
      - "${MEMOS_HOST_PORT:-5230}:5230"
    volumes:
      - ./data:/var/opt/memos
    environment:
      MEMOS_PORT: "5230"
      MEMOS_INSTANCE_URL: "${MEMOS_INSTANCE_URL:-}"
      TZ: "${TZ:-Asia/Shanghai}"
YAML

cat > .env <<'ENV'
MEMOS_HOST_PORT=5230
TZ=Asia/Shanghai
# MEMOS_INSTANCE_URL=https://memos.example.com
ENV

mkdir -p data
docker compose up -d
```

跳到 **§7 验证**。

---

## 4. 模式 B — 源码构建（本 fork，推荐）

### 4.1 获取源码

在**有 Node 20+ 与 pnpm 的机器**（可在服务器上）构建前端。

```bash
# 克隆（把 URL 换成实际仓库）
REPO_DIR=/opt/memos/src
mkdir -p "$(dirname "$REPO_DIR")"
git clone --depth 1 https://github.com/GZY-q/memos.git "$REPO_DIR"
cd "$REPO_DIR"
git log -1 --oneline
```

### 4.2 构建前端（Dockerfile 依赖预构建 dist）

仓库 `.dockerignore` **排除了 `web/`**，镜像内嵌的是 `server/router/frontend/dist`。  
**必须先**：

```bash
cd "$REPO_DIR/web"
# Node 20+ / 24；pnpm 9+ 或 corepack
corepack enable 2>/dev/null || true
pnpm install --frozen-lockfile || pnpm install
pnpm release
test -f "$REPO_DIR/server/router/frontend/dist/index.html" || { echo "FATAL: frontend dist missing"; exit 1; }
cd "$REPO_DIR"
```

### 4.3 写 compose 并构建

```bash
cd "$REPO_DIR/deploy"
cp .env.example .env

cat >> .env <<'ENV'
MEMOS_VERSION=dev
MEMOS_COMMIT=$(git -C .. rev-parse --short HEAD)
ENV

# 可选：绑定仅本机（有反代时）
# 将 ports 改为 127.0.0.1:5230:5230 — 见 §6

mkdir -p data
export GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"

docker compose -f docker-compose.build.yml up -d --build
```

构建说明：

- 基础镜像：`golang:1.27.0-alpine`、`alpine:3.21`
- 架构跟随服务器（amd64/arm64 均可）
- 首次构建约 5–15 分钟（视 CPU/网络）

若 `docker compose -f docker-compose.build.yml` 失败，回退：

```bash
cd "$REPO_DIR"
docker build -f scripts/Dockerfile -t memos:dev --build-arg VERSION=dev .
docker rm -f memos 2>/dev/null || true
docker run -d --name memos --restart unless-stopped \
  -p 5230:5230 \
  -v "$REPO_DIR/deploy/data:/var/opt/memos" \
  -e TZ=Asia/Shanghai \
  memos:dev
```

---

## 5. 无 Docker 的二进制路径（备用）

若仓库含 `build/memos-linux-amd64` 且服务器无 Docker：

```bash
sudo install -m 755 memos-linux-amd64 /usr/local/bin/memos
sudo mkdir -p /var/opt/memos
sudo useradd -r -M -d /var/opt/memos memos 2>/dev/null || true
sudo chown -R memos:memos /var/opt/memos

sudo tee /etc/systemd/system/memos.service >/dev/null <<'UNIT'
[Unit]
Description=Memos
After=network.target
[Service]
User=memos
WorkingDirectory=/var/opt/memos
ExecStart=/usr/local/bin/memos --port 5230 --data /var/opt/memos
Restart=unless-stopped
AmbientCapabilities=CAP_NET_BIND_SERVICE
[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now memos
```

确认 CLI 参数：`memos --help`（若与上述不符，以 help 为准并改 unit）。

---

## 6. HTTPS 反代（生产强烈建议）

### 6.1 Caddy（自动证书，优先）

```bash
# Debian/Ubuntu 示例
sudo apt-get update && sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update && sudo apt-get install -y caddy
```

`/etc/caddy/Caddyfile`：

```
memos.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:5230
}
```

同时把 compose 端口改为仅本机：

```yaml
ports:
  - "127.0.0.1:5230:5230"
```

```bash
docker compose up -d   # 或 -f docker-compose.build.yml
sudo systemctl reload caddy
```

DNS：`A` 记录 `memos.example.com` → 服务器公网 IP。

### 6.2 Nginx + certbot（备选）

```nginx
server {
  listen 443 ssl http2;
  server_name memos.example.com;
  ssl_certificate     /etc/letsencrypt/live/memos.example.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/memos.example.com/privkey.pem;
  location / {
    proxy_pass http://127.0.0.1:5230;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";  # SSE / WebSocket
    proxy_read_timeout 3600s;
  }
}
```

---

## 7. 验证清单（AI 必须执行）

```bash
# 容器
docker ps --filter name=memos --format '{{.Names}} {{.Status}} {{.Ports}}'
docker logs memos --tail 50

# HTTP
curl -fsS -o /dev/null -w "healthz %{http_code}\n" http://127.0.0.1:5230/healthz
curl -fsS -o /dev/null -w "root %{http_code}\n" http://127.0.0.1:5230/

# 若有域名
curl -fsS -o /dev/null -w "https %{http_code}\n" "https://memos.example.com/healthz" || true
```

期望：

| 检查 | 期望 |
| --- | --- |
| healthz | `200`，body 含 `Service ready` |
| 容器 | `Up`，`restart=unless-stopped` |
| 首次打开 | 初始化向导 / 注册第一个用户（Host） |
| 数据 | `deploy/data/` 出现 `memos_prod.db*` |

**安全组 / 防火墙**（云厂商控制台或 ufw）：

- 放行 `5230`（仅当无反代且需公网直连）
- 或只放行 `80/443`，应用绑 `127.0.0.1`

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80,443/tcp    # 有 HTTPS 时
# sudo ufw allow 5230/tcp    # 仅调试时临时
sudo ufw enable
```

---

## 8. 初始化后的必做配置

1. 浏览器打开 URL → 注册**第一个账号**（自动成为 Host/管理员）。
2. **设置 → 系统**：实例 URL、访问模式（PUBLIC/PRIVATE）。
3. **设置 → 个人访问令牌**：创建 PAT，用于备份/自动化。
4. fork：**设置 → 审计日志** 可查看登录与导出记录。
5. fork：**设置 → AI** 可配置 TTS/STT（可选）。

备份导出（fork）：

```bash
TOKEN='你的 PAT'
curl -fsS -H "Authorization: Bearer $TOKEN" \
  "http://127.0.0.1:5230/api/v1/export/me?format=markdown" -o memos-export.md
```

---

## 9. 备份与升级

### 9.1 备份（SQLite 停机或文件拷贝）

```bash
cd /opt/memos/deploy   # 或 $REPO_DIR/deploy
docker compose stop
tar czf "/backup/memos-$(date +%F).tar.gz" data
docker compose start
```

### 9.2 官方镜像升级

```bash
docker compose pull
docker compose up -d
```

### 9.3 源码构建升级

```bash
cd "$REPO_DIR"
git pull
cd web && pnpm install && pnpm release && cd ..
cd deploy
docker compose -f docker-compose.build.yml up -d --build
```

升级前始终备份 `data/`。

---

## 10. 故障排查

| 症状 | 处理 |
| --- | --- |
| 空白页 / 白屏 | 源码构建是否执行了 `pnpm release`；`docker logs memos`；浏览器控制台 |
| healthz 失败 | 端口占用 `ss -lptn \| grep 5230`；容器是否在跑 |
| 502 经反代 | 反代是否指向 `127.0.0.1:5230`；SSE 需长超时与 Upgrade 头 |
| 构建失败 go mod | 设置 `GOPROXY`；检查 Go 1.27 镜像是否拉得动 |
| 权限错误写 data | `chown -R 10001:10001 data`（镜像内 nonroot uid） |
| 时区不对 | `.env` 中 `TZ`，重建容器 |
| 迁移卡住 | 备份 data 后查看启动日志 schemaVersion |

---

## 11. AI 收尾报告模板

部署完成后向用户输出：

```markdown
## 部署完成

- 模式：官方镜像 / 源码构建
- 地址：http(s)://...
- 数据目录：/opt/memos/deploy/data（或实际路径）
- 端口：5230（公网 / 仅本机）
- HTTPS：是（Caddy/Nginx） / 否
- 容器：docker ps 输出摘要
- healthz：200

### 默认采用的决策
- 端口 5230、时区 Asia/Shanghai、SQLite
- ...

### 建议人工复核
- [ ] 云安全组仅开必要端口
- [ ] 定期备份 data/
- [ ] 修改 Host 强密码；按需开启 PRIVATE 模式
- [ ] 若未上 HTTPS，尽快配置
```

---

## 12. 一页速查（复制给 AI 的最短指令）

```text
在 Linux 服务器上部署本 Memos fork：
1) 安装 Docker（若无）
2) git clone 仓库到 /opt/memos/src
3) cd src/web && pnpm install && pnpm release   # 必须先构建前端
4) cd src/deploy && cp .env.example .env
5) docker compose -f docker-compose.build.yml up -d --build
6) curl http://127.0.0.1:5230/healthz 必须 200
7) 输出部署报告（模式、URL、数据路径、安全组建议）
域名与 HTTPS 未指定则跳过反代，但在报告中提醒。
```

---

## 参考

- 仓库 `deploy/DEPLOY.md`、`scripts/Dockerfile`
- 上游文档：https://usememos.com/docs/deploy
- 本 fork README 中的开发与 API 说明
