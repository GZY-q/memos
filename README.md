> This repository is a **community fork** of [usememos/memos](https://github.com/usememos/memos).
> Core product vision, branding, and most of the codebase belong to the upstream Memos project and its contributors.
> Please prefer contributing generally useful features upstream. Fork-specific additions are documented below.
> Upstream: https://github.com/usememos/memos · Docs: https://usememos.com/docs · Demo: https://demo.usememos.com/

# Memos (fork)

<img src="./web/public/logo.webp" alt="" width="96" align="right">

**Fast enough for every thought. Private enough for all of them.**

Memos is an open-source, self-hosted home for short-form thinking. Daily notes, links, work logs, and snippets flow into a chronological Markdown timeline—on infrastructure you control, without the overhead of an all-in-one workspace.

This fork keeps that foundation and adds a few self-hosted operator and daily-driver improvements (navigation start page, TTS, audit trail, faster search, offline drafts, journal view).

**[Quick start](#quick-start)** · **[Upstream demo](https://demo.usememos.com/)** · **[Upstream docs](https://usememos.com/docs)**

[![GitHub stars](https://img.shields.io/github/stars/usememos/memos?style=flat-square&logo=github&label=Upstream%20Stars)](https://github.com/usememos/memos)
[![Latest release](https://img.shields.io/github/v/release/usememos/memos?style=flat-square&label=Upstream%20Release)](https://github.com/usememos/memos/releases)
[![Docker pulls](https://img.shields.io/docker/pulls/neosmemo/memos?style=flat-square&logo=docker)](https://hub.docker.com/r/neosmemo/memos)
[![MIT license](https://img.shields.io/github/license/usememos/memos?style=flat-square)](LICENSE)

<img src="https://raw.githubusercontent.com/usememos/.github/refs/heads/main/assets/demo.png" alt="Memos Demo Screenshot" height="512" />

## Why Memos?

- **Capture quickly** — Write in Markdown, attach media, and save without choosing a title, folder, or template.
- **Organize lightly** — Revisit notes through the timeline, search, tags, and pins.
- **Share selectively** — Keep memos private or publish only what you choose.
- **Keep control** — Self-host Memos with [zero telemetry](https://usememos.com/features/data-ownership) and [MIT-licensed source](LICENSE).

[Explore all upstream features →](https://usememos.com/features)

## What this fork adds

| Area | What you get |
| --- | --- |
| **Navigation start page** | Bookmark card wall, browser import, custom search engines (`{q}`), clipboard history. Config is local-first (IndexedDB) with optional memo backup. |
| **Journal** | `/journal` day view with day-scoped composer and sidebar entry. |
| **TTS read-aloud** | Microsoft Edge (keyless) or Volcengine Ark; playback queue; IndexedDB audio cache. |
| **Import** | Settings → Import: Flomo JSON, CSV, Obsidian `.md` / zip. |
| **Offline drafts** | Failed saves queue locally and auto-flush when the network returns. |
| **Faster content search** | SQLite FTS5 trigram, MySQL ngram `MATCH`, optional Postgres `pg_trgm`; `attachment_filename.contains` / `comment.contains`. |
| **Operator hardening** | Per-IP rate limit on sign-in / refresh / registration; `GET /api/v1/export/me`; audit log (table + admin UI + CSV). |
| **PWA shell** | Production service worker caches the SPA shell only (never API/SSE). |

Rebase notes: [`PATCHES.md`](./PATCHES.md). Contributor conventions: [`AGENTS.md`](./AGENTS.md).

## Quick Start

### Deploy this fork (source build)

Official Docker Hub image `neosmemo/memos` does **not** include this fork’s features. Build from source:

```bash
git clone <this-repo-url> memos && cd memos
cd web && pnpm install && pnpm release && cd ..   # required before docker build
cd deploy && cp .env.example .env
docker compose -f docker-compose.build.yml up -d --build
# open http://<server>:5230
```

Full steps (HTTPS, backup, AI-agent script): [`deploy/AI_DEPLOY.md`](./deploy/AI_DEPLOY.md) · [`deploy/DEPLOY.md`](./deploy/DEPLOY.md).

### Development (this fork)

```bash
# Backend (SQLite by default)
go run ./cmd/memos --port 8081

# Frontend (proxies API to :8081)
cd web && pnpm install && pnpm dev
# open http://localhost:3001
```

### Upstream-only image (no fork features)

Stock Memos without navigation/TTS/audit/etc. — use upstream docs only if you do not need this fork:

```bash
docker run -d \
  --name memos \
  -p 5230:5230 \
  -v ~/.memos:/var/opt/memos \
  neosmemo/memos:stable
```

Upstream install guide: https://usememos.com/docs/deploy.

Useful APIs after sign-in:

```bash
# Personal export (Bearer access token or PAT)
curl -H "Authorization: Bearer $TOKEN" \
  'http://localhost:8081/api/v1/export/me?format=markdown'

# Audit log (instance admin only)
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:8081/api/v1/audit-logs?limit=50'
```

## Web Clipper

Save pages, selections, and images from your browser straight into Memos as source-linked Markdown. Get the [Memos Web Clipper](https://usememos.com/web-clipper) for [Chrome](https://chromewebstore.google.com/detail/memos-web-clipper/nebaoebnljalfegiidibihhkebeiklbl) or [Firefox](https://addons.mozilla.org/en-US/firefox/addon/memos-web-clipper/).

## Credits & license

- **Upstream**: [usememos/memos](https://github.com/usememos/memos) and all of its contributors. This fork would not exist without their work.
- **License**: [MIT](./LICENSE), same as upstream.
- Upstream sponsors are listed below — please consider supporting the original project.

### Upstream sponsors

<p>
  <a href="https://coderabbit.link/usememos" target="_blank" rel="noopener"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/usememos/.github/refs/heads/main/assets/sponsors/coderabbit/white-typemark.svg" /><img src="https://raw.githubusercontent.com/usememos/.github/refs/heads/main/assets/sponsors/coderabbit/orange-typemark.svg" alt="CodeRabbit — Cut code review time and bugs in half" height="40" align="middle" /></picture></a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://ssdnodes.com/?utm_source=memos&utm_medium=sponsor" target="_blank" rel="noopener"><img src="https://raw.githubusercontent.com/usememos/.github/refs/heads/main/assets/sponsors/ssd-nodes.svg" alt="SSD Nodes — Affordable VPS hosting for self-hosters" height="72" align="middle" /></a>
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <a href="https://www.testmuai.com/?utm_medium=sponsor&utm_source=memos" target="_blank" rel="noopener"><picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/usememos/.github/refs/heads/main/assets/sponsors/testmuai/white.png" /><img src="https://raw.githubusercontent.com/usememos/.github/refs/heads/main/assets/sponsors/testmuai/black.png" alt="TestMu AI — The world’s first full-stack Agentic AI Quality Engineering platform" height="30" align="middle" /></picture></a>
</p>

Love Memos? [Sponsor upstream on GitHub](https://github.com/sponsors/usememos).

## Get help

- **Upstream**: [docs](https://usememos.com/docs), [Discord](https://discord.gg/tfPJa4UmAv), [Discussions](https://github.com/usememos/memos/discussions), [issues](https://github.com/usememos/memos/issues/new/choose).
- **This fork**: open an issue here for fork-specific behavior (navigation, TTS, audit, import, search). Prefer filing general Memos bugs upstream.

## Upstream star history

<a href="https://www.star-history.com/?repos=usememos%2Fmemos&amp;type=date&amp;legend=top-left">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/chart?repos=usememos/memos&amp;type=date&amp;theme=dark&amp;legend=top-left" />
    <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/chart?repos=usememos/memos&amp;type=date&amp;legend=top-left" />
    <img alt="Memos star history chart" src="https://api.star-history.com/chart?repos=usememos/memos&amp;type=date&amp;legend=top-left" />
  </picture>
</a>
