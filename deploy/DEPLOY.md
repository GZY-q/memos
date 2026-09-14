# 本仓库（自建 Fork）云端部署

**部署本 fork 请只用源码构建。** 官方镜像 `neosmemo/memos` **不含**导航 / 日记 / TTS / 审计 / FTS / 导出 / 导入等本仓库功能。

完整可交给 AI 执行的步骤见 **[AI_DEPLOY.md](./AI_DEPLOY.md)**。

## 必须用源码构建的原因

| 方式 | 镜像 | 本 fork 功能 |
| --- | --- | --- |
| **`docker-compose.build.yml`（本仓库）** | 本地 `memos:<commit>` | 完整 |
| `docker-compose.yml` / `neosmemo/memos:stable` | 官方镜像 | **无 fork 功能** |
| `../build/memos-linux-*` | 本地二进制 | 视构建内容 |

> `scripts/Dockerfile` **不会**在镜像内编译前端（`.dockerignore` 排除 `web/`）。构建镜像前必须先在仓库根执行 `cd web && pnpm install && pnpm release`。

## 国内网络（强烈建议先配）

不配加速时，`docker pull`、`go mod`、`pnpm install`、`git clone` 都可能失败。

```bash
# Docker 镜像
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

# Go / npm
export GOPROXY=https://goproxy.cn,direct
npm config set registry https://registry.npmmirror.com
pnpm config set registry https://registry.npmmirror.com
```

`deploy/.env.example` 已含 `GOPROXY=https://goproxy.cn,direct`，会传入 `docker build`。  
GitHub 拉不动时，用本机 `rsync` 把整个仓库（排除 `.git`、`web/node_modules`、`deploy/data`）传到服务器。完整步骤见 [AI_DEPLOY.md](./AI_DEPLOY.md) §1.4、§2.2。

## 快速部署（本 fork）

在服务器上：

```bash
# 1) 源码（clone 本仓库，或 rsync 整个仓库）
git clone <本仓库 URL> /opt/memos/src
cd /opt/memos/src

# 2) 前端打进 Go embed 目录（必须）
cd web && pnpm install && pnpm release && cd ..

# 3) 构建并启动
cd deploy
cp .env.example .env
# 可选：MEMOS_VERSION / MEMOS_COMMIT / MEMOS_HOST_PORT / MEMOS_INSTANCE_URL
mkdir -p data
docker compose -f docker-compose.build.yml up -d --build
```

浏览器打开 `http://<服务器IP>:5230`，注册第一个用户（Host）。

验证是本 fork 构建：

```bash
curl -fsS http://127.0.0.1:5230/healthz   # Service ready.
docker images | grep memos                # 本地 memos:<hash>，不是 neosmemo/memos
```

侧栏应有导航 / 日记；设置里应有审计日志、导入。

## 数据与升级

- 数据卷：`./data`（SQLite `memos_prod.db` + 附件）
- 升级：

```bash
cd /opt/memos/src
git pull   # 或 rsync 新代码
cd web && pnpm install && pnpm release && cd ..
cd deploy
tar czf "/backup/memos-$(date +%F).tgz" data   # 建议
docker compose -f docker-compose.build.yml up -d --build
```

## 常用环境变量

| 变量 | 说明 |
| --- | --- |
| `MEMOS_HOST_PORT` | 宿主机端口，默认 `5230` |
| `MEMOS_INSTANCE_URL` | 对外完整 URL，如 `https://memos.example.com` |
| `TZ` | 时区，默认 `Asia/Shanghai` |
| `MEMOS_VERSION` / `MEMOS_COMMIT` | 构建标签（`docker-compose.build.yml`） |
| `MEMOS_DSN` | 可选，MySQL/PostgreSQL DSN（默认 SQLite） |

完整配置见 `docs/configuration-provisioning.md`。

## 生产建议（HTTPS 反代）

Caddy / Nginx 终结 TLS，反代到 `127.0.0.1:5230`；compose 端口改为：

```yaml
ports:
  - "127.0.0.1:5230:5230"
```

Caddy：

```
memos.example.com {
    reverse_proxy 127.0.0.1:5230
}
```

## 防火墙 / 安全组

- HTTPS：放行 80/443，应用只绑本机
- 调试直连：放行 `5230`，并限制来源 IP
- 不要把 `./data` 放到静态站点目录

## 验证

```bash
docker compose -f docker-compose.build.yml ps
docker compose -f docker-compose.build.yml logs -f memos --tail 50
curl -fsS http://127.0.0.1:5230/healthz
```

## 相关文件

| 文件 | 用途 |
| --- | --- |
| [AI_DEPLOY.md](./AI_DEPLOY.md) | 给 AI 的无人值守部署步骤 |
| `docker-compose.build.yml` | **本 fork 推荐** |
| `docker-compose.yml` | 上游官方镜像 compose（本 fork 不用） |
| `../scripts/Dockerfile` | 源码构建镜像 |
