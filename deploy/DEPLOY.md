# Memos 云端 Docker Compose 部署

本机未安装 Docker，镜像需在云服务器上构建/拉取。二进制产物在 `../build/`，适合不用 Docker 的场景。

## 选哪种方式

| 方式 | 适用 |
| --- | --- |
| `docker-compose.yml` | 无定制，直接跑官方 `neosmemo/memos:stable`（推荐） |
| `docker-compose.build.yml` | 这个 fork / 本地改动，需要从源码构建 |
| `../build/memos-linux-*` | 服务器没有 Docker，直接丢静态二进制 |

## 方式一：官方镜像（最快）

```bash
# 把 deploy/ 目录上传到服务器后
cd deploy
cp .env.example .env
# 编辑 .env，至少设置 MEMOS_INSTANCE_URL（如有域名）

docker compose up -d
```

浏览器打开 `http://<服务器IP>:5230`，首次访问会进入初始化向导。

## 方式二：从本仓库源码构建

在服务器上准备好仓库（`git clone` 或 `rsync` 整个仓库，保留 `scripts/Dockerfile`）：

```bash
cd memos/deploy
cp .env.example .env
# 填写 MEMOS_VERSION / MEMOS_COMMIT（可选）

docker compose -f docker-compose.build.yml up -d --build
```

构建阶段需要拉 `golang:1.27.0-alpine` 与 `alpine:3.21`；国内服务器建议先配好镜像加速。

## 数据与升级

- 数据卷：`./data`（SQLite 默认 `memos_prod.db`，上传附件也在里面）
- 升级官方镜像：

```bash
docker compose pull
docker compose up -d
```

- 升级源码构建：拉新代码后重新 `--build`。升级前建议备份 `./data`。

## 常用环境变量

| 变量 | 说明 |
| --- | --- |
| `MEMOS_HOST_PORT` | 宿主机端口，默认 `5230` |
| `MEMOS_INSTANCE_URL` | 对外完整 URL，如 `https://memos.example.com`；不设则私有模式 |
| `TZ` | 时区，默认 `Asia/Shanghai` |
| `MEMOS_DSN` | 可选，MySQL/PostgreSQL 连接串（默认 SQLite） |

完整配置见 `docs/configuration-provisioning.md`。

## 生产建议（HTTPS 反代）

云上建议用 Caddy / Nginx / 云负载终结 TLS，再反代到 `127.0.0.1:5230`。

Caddy 示例：

```
memos.example.com {
    reverse_proxy 127.0.0.1:5230
}
```

若走反代，端口可以只绑本机：

```yaml
ports:
  - "127.0.0.1:5230:5230"
```

## 防火墙 / 安全组

- 放行 80/443（HTTPS）
- 若不用反代、直接暴露应用，放行 `5230`，并尽量限制来源 IP
- 不要把 `./data` 目录公开到静态站点目录

## 验证

```bash
docker compose ps
docker compose logs -f memos --tail 50
curl -I http://127.0.0.1:5230
```
