# 本仓库（自建 Fork）云服务器自动部署指南

> **给 AI / 自动化 Agent**：只部署 **本仓库源码构建的镜像**，**禁止**使用官方镜像 `neosmemo/memos:*`。  
> 本 fork 含导航页、TTS、审计、FTS、导出、日记、导入等；官方镜像没有这些功能。  
> 无人值守执行；需要人类决策时用文中默认值，并在结束时汇报「已采用的默认值」与「建议人工复核项」。

---

## 0. 部署目标

| 项 | 值 |
| --- | --- |
| 应用 | 本 fork 自建 Memos（Go + 内嵌前端） |
| 方式 | Docker 源码构建（`scripts/Dockerfile`） |
| 镜像名 | `memos:<git短哈希>` 或 `memos:dev` |
| 容器名 | `memos` |
| 端口 | `5230`（可改 `MEMOS_HOST_PORT`） |
| 数据 | `./data` → 容器内 `/var/opt/memos`（SQLite + 附件） |
| 重启 | `unless-stopped` |

**架构要求**：服务器需能拉取 `golang:1.27.0-alpine`、`alpine:3.21`，并执行 `pnpm` 构建前端（见 §3）。

---

## 1. 前置检查（必须，失败则先修复）

```bash
uname -m                          # x86_64 或 aarch64
docker --version && docker compose version
git --version
node --version                    # 建议 ≥20
corepack enable 2>/dev/null || true
pnpm --version || npm i -g pnpm   # 需要 pnpm 构建前端
free -h | head -2                 # 建议 ≥2GB（构建时）
df -h / | tail -1                 # 建议 ≥15GB
```

### 1.1 安装 Docker（若无）

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
# 重新登录后
docker run --rm hello-world
```

### 1.2 安装 Node/pnpm（若无，用于前端）

```bash
# 示例：NodeSource Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
corepack enable && corepack prepare pnpm@latest --activate
node -v && pnpm -v
```

### 1.3 国内网络加速（可选）

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
export GOPROXY=https://goproxy.cn,direct
export npm_config_registry=https://registry.npmmirror.com
```

---

## 2. 获取本仓库源码

**必须使用本 fork 仓库**（不要 clone 上游 usememos/memos）。

```bash
# 若你有私有/自定义 URL，替换下面地址
REPO_URL="${REPO_URL:-https://github.com/GZY-q/memos.git}"
REPO_DIR="${REPO_DIR:-/opt/memos/src}"

mkdir -p "$(dirname "$REPO_DIR")"
if [ -d "$REPO_DIR/.git" ]; then
  git -C "$REPO_DIR" fetch --depth 1 origin
  git -C "$REPO_DIR" checkout -B deploy origin/HEAD || git -C "$REPO_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"
git log -1 --oneline
test -f scripts/Dockerfile || { echo "FATAL: missing scripts/Dockerfile — wrong repo?"; exit 1; }
test -f deploy/docker-compose.build.yml || { echo "FATAL: missing deploy/docker-compose.build.yml"; exit 1; }
```

用 rsync 上传本地已改好的代码也可以：

```bash
rsync -az --delete --exclude .git --exclude web/node_modules --exclude 'deploy/data' \
  ./ user@server:/opt/memos/src/
```

---

## 3. 构建前端（镜像构建前必做）

Docker 构建**不会**编译前端：`.dockerignore` 排除了 `web/`，镜像只嵌入 `server/router/frontend/dist`。

```bash
cd "$REPO_DIR/web"
pnpm install --frozen-lockfile || pnpm install
pnpm release
test -f "$REPO_DIR/server/router/frontend/dist/index.html" || {
  echo "FATAL: pnpm release did not produce dist/index.html"
  exit 1
}
```

跳过本步 → 容器启动后**白屏**。

---

## 4. 构建并启动容器

```bash
cd "$REPO_DIR/deploy"
cp -n .env.example .env

# 写入版本信息
GIT_COMMIT=$(git -C "$REPO_DIR" rev-parse --short HEAD)
{
  echo "MEMOS_VERSION=${GIT_COMMIT}"
  echo "MEMOS_COMMIT=${GIT_COMMIT}"
} >> .env

# 默认：主机 5230 → 容器 5230；有 HTTPS 反代时改为仅本机见 §6
mkdir -p data

export GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"

docker compose -f docker-compose.build.yml up -d --build
```

### 4.1 compose 构建失败时的备用命令

```bash
cd "$REPO_DIR"
export GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"
docker build -f scripts/Dockerfile \
  -t "memos:${GIT_COMMIT:-dev}" \
  --build-arg VERSION="${GIT_COMMIT:-dev}" \
  --build-arg COMMIT="${GIT_COMMIT:-unknown}" \
  .

docker rm -f memos 2>/dev/null || true
docker run -d --name memos --restart unless-stopped \
  -p "${MEMOS_HOST_PORT:-5230}:5230" \
  -v "$REPO_DIR/deploy/data:/var/opt/memos" \
  -e TZ="${TZ:-Asia/Shanghai}" \
  "memos:${GIT_COMMIT:-dev}"
```

> 容器内数据目录属主是 uid/gid **10001**。若宿主机写权限报错：  
> `sudo chown -R 10001:10001 "$REPO_DIR/deploy/data"`

---

## 5. 验证（必须全部通过）

```bash
docker ps --filter name=memos --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
docker images | grep memos | head -5
docker logs memos --tail 80

curl -fsS http://127.0.0.1:5230/healthz
# 期望：Service ready.
curl -fsS -o /dev/null -w "root %{http_code}\n" http://127.0.0.1:5230/
# 期望：200

# 确认不是官方镜像
docker inspect memos --format '{{.Config.Image}} {{.Config.Labels}}'
```

**期望结果**：

| 检查 | 期望 |
| --- | --- |
| Image | `memos:<commit>` 或本地 tag，**不是** `neosmemo/memos` |
| healthz | 200 + `Service ready` |
| 启动日志 | 有 schema 迁移或 `Server running on port 5230` |
| 首次打开 | 初始化 / 注册第一个用户（Host） |

### 5.1 验证是「你的构建」而非官方包

注册后检查 fork 功能（任选其一）：

- 侧栏是否有 **导航** / **日记** 入口  
- 设置里是否有 **审计日志**、**导入**  
- `curl -s http://127.0.0.1:5230/healthz` 后，浏览器打开 `http://<IP>:5230` 能看到自定义导航页  

若只有官方 UI、无 fork 入口 → 说明跑错镜像或前端 dist 未构建，回到 §3。

### 5.2 防火墙 / 云安全组

- 无反代：放行 `5230`（或 `MEMOS_HOST_PORT`）
- 有 HTTPS：只放行 `22/80/443`，应用端口绑 `127.0.0.1`

```bash
sudo ufw allow 22/tcp
sudo ufw allow 5230/tcp   # 调试期；生产建议只留 80/443
sudo ufw enable
```

---

## 6. HTTPS 反代（生产建议）

### 6.1 把应用端口改为仅本机

编辑 `deploy/docker-compose.build.yml` 或 `.env` 对应端口映射：

```yaml
ports:
  - "127.0.0.1:5230:5230"
```

```bash
cd "$REPO_DIR/deploy"
docker compose -f docker-compose.build.yml up -d
```

### 6.2 Caddy

```
# /etc/caddy/Caddyfile
memos.example.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:5230
}
```

```bash
sudo systemctl reload caddy
```

DNS：`A` 记录指向服务器公网 IP。

### 6.3 Nginx 要点

- `proxy_pass http://127.0.0.1:5230`
- 必须传 `Host`、`X-Forwarded-Proto`
- SSE/WebSocket：`Upgrade`/`Connection` + 长 `proxy_read_timeout`

---

## 7. 数据、备份、升级

### 7.1 位置

- 宿主机：`$REPO_DIR/deploy/data/`
- 内容：`memos_prod.db*`、上传附件等

### 7.2 备份

```bash
cd "$REPO_DIR/deploy"
docker compose -f docker-compose.build.yml stop
tar czf "/backup/memos-$(date +%F-%H%M).tar.gz" data
docker compose -f docker-compose.build.yml start
```

### 7.3 升级你的新代码

```bash
cd "$REPO_DIR"
git pull   # 或 rsync 新代码
cd web && pnpm install && pnpm release
cd ../deploy
docker compose -f docker-compose.build.yml up -d --build
```

升级前备份 `data/`。

---

## 8. 故障排查

| 症状 | 原因与处理 |
| --- | --- |
| 白屏 / 无 fork 功能 | §3 未 `pnpm release`，或构建时 dist 为空 |
| 拉不到 `golang:1.27` | 配置 Docker 镜像加速；换网络重试 |
| go mod 超时 | `export GOPROXY=https://goproxy.cn,direct` 后重建 |
| pnpm 失败 | `npm_config_registry=https://registry.npmmirror.com` |
| 端口占用 | `ss -lptn \| grep 5230`，改 `MEMOS_HOST_PORT` |
| data 权限 | `chown -R 10001:10001 deploy/data` |
| 反代 502 | 确认容器在听 5230 且反代指向 127.0.0.1 |
| 误用了官方镜像 | `docker rm -f memos`，改用 `docker-compose.build.yml` 重建 |

---

## 9. AI 收尾报告（必须）

```markdown
## 自建 Fork 部署完成

- 仓库：/opt/memos/src（commit: <hash>）
- 镜像：memos:<hash>（本地构建，非 neosmemo/memos）
- 地址：http(s)://...
- 数据：/opt/memos/src/deploy/data
- healthz：200
- fork 功能抽查：导航/日记/审计/导入 — 通过/未测

### 默认决策
- 端口 5230、TZ Asia/Shanghai、SQLite、单容器

### 人工复核
- [ ] 安全组最小端口
- [ ] 定期备份 data/
- [ ] Host 账号强密码
- [ ] HTTPS（若尚未配置）
```

---

## 10. 一页速查（可整段丢给 AI）

```text
部署我自己的 Memos fork（禁止官方镜像 neosmemo/memos）：

1) 确认 Docker + Node20 + pnpm
2) git clone 我的仓库到 /opt/memos/src（或 rsync 源码）
3) cd src/web && pnpm install && pnpm release   # 必须，否则白屏
4) cd src/deploy && cp .env.example .env
5) docker compose -f docker-compose.build.yml up -d --build
6) curl http://127.0.0.1:5230/healthz 必须 200
7) docker images 确认镜像为本地 memos:<hash>
8) 浏览器检查侧栏是否有导航/日记、设置是否有审计/导入
9) 汇报 commit、URL、数据路径与安全组建议

域名 HTTPS 未指定则跳过反代，报告中提醒。
```

---

## 相关文件

- `deploy/docker-compose.build.yml` — 源码构建 compose  
- `scripts/Dockerfile` — 多阶段构建（前端 dist 已预构建）  
- `deploy/DEPLOY.md` — 简版说明  
- 上游文档仅作参考：功能以本 fork 为准  
