---
title: 项目介绍-repodex
description: 基于 GitHub Actions、Cloudflare Workers 和 React + Vite + Kumo 前端，实现了一套跨仓库、跨分支的多维度模糊搜索系统，以提升用户在 GitHub 上的文件检索效率。
date: 2026-01-16
lastmod: 2026-09-10
image:
categories:
  - 项目
tags:
  - Cloudflare
  - GitHub
  - 模糊搜索
weight: 1
---

# RepoDex

[![Check](https://github.com/Jy-EggRoll/repodex/actions/workflows/check.yml/badge.svg)](https://github.com/Jy-EggRoll/repodex/actions/workflows/check.yml)

English | [简体中文](./README_zh-cn.md)

RepoDex (**Repo**sitoryIn**dex**) aggregates repository indexes into a **cross-repository, cross-branch fuzzy file search** system, built on GitHub Actions, Cloudflare Workers, and a React + Vite + Kumo frontend.

- Try it online (demo data is fictional; the search logic is the same as production): [RepoDex Demo](https://jy-eggroll.github.io/repodex/)
- Blog post: [项目介绍-RepoDex](https://eggroll.pages.dev/p/项目介绍-repodex/)

The project is designed to be **easy to configure and free to run**: in normal use you will stay **far below** the free tiers of GitHub Actions and Cloudflare, so you can deploy it with confidence and no billing concerns.

## Why RepoDex

Over time, developers accumulate many repositories on GitHub — code, documents, resources. GitHub itself has no **global file search across repositories and branches**, which makes finding a file painful. For Chinese users it is worse: many filenames are Chinese, and GitHub does not support pinyin fuzzy search.

RepoDex fills that gap with a cross-repository, cross-branch fuzzy search system to make file retrieval on GitHub efficient.

## What it looks like

### Mobile-friendly

![Mobile](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/移动端.png)

The screenshot above uses "Search by name" — note how English, Chinese, full pinyin, and pinyin initials all match.

![Index selection](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/选择索引.png)

Indexes can be selected (all selected by default). The dialog filters index names live and offers select all / invert / clear in one click; changing the selection re-searches immediately when a keyword exists. Search is manually submitted (Enter or the button), at most the first 100 results are shown, and huge matches are scored only up to the first 1000 entries with an approximate total — so requests never time out.

### Clean wide-screen layout

![Wide screen](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/宽屏.png)

Repository risk badges: `>900MB` danger, `800–900MB` warning, `<800MB` safe. You should not keep repositories larger than 1GB — there are many reasons, which we won't get into here.

### Other highlights

- Repositories and files link straight to GitHub.
- Files from all branches are searched by default (determined by the index).
- Three theme modes (follow system / light / dark; defaults to follow system, and a manual choice is remembered).
- Bilingual UI — English / 简体中文 — auto-detected from the browser, switchable manually, and the choice is remembered. All UI strings are wrapped through the l10n layer (VS Code l10n style: English source strings as keys, bundles in `/l10n`).

## Deployment

All you need is one Cloudflare account (no credit card required). Five steps, six secrets total — overview first (details in each step):

| Secret            | Where to set                     | Purpose                                                              |
| ----------------- | -------------------------------- | -------------------------------------------------------------------- |
| `CF_ACCOUNT_ID`   | This repo, Actions secrets       | KV endpoint                                                          |
| `CF_NAMESPACE_ID` | This repo, Actions secrets       | KV endpoint                                                          |
| `CF_API_TOKEN`    | This repo, Actions secrets       | Writes to KV (needs Workers KV Storage write permission)             |
| `REPOS_PAT`       | This repo, Actions secrets       | Reads repo file trees for central indexing (fine-grained, read-only) |
| `USER` / `PSWD`   | Worker variables ("secret" type) | Site login                                                           |

### 1. Fork and connect

![Fork](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image.png)

If you find this project helpful, a star would be very much appreciated.

![Setup flow](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-1.png)

Copy the Account ID (= `CF_ACCOUNT_ID`).

![Connect GitHub](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-2.png)

Connect to GitHub (grant authorization if asked) and pick your fork.

> [!IMPORTANT]
>
> Build settings: build command `pnpm build`, deploy command `npx wrangler deploy`. Deployment fails without the build command (the output directory `dist/` is already configured in `wrangler.jsonc`, no need to specify it).

### 2. Three things on the Cloudflare side

![Create KV](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-3.png)

Create a KV namespace (any name), refresh the page, and copy its ID (= `CF_NAMESPACE_ID`).

![Create token](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-4.png)

Create a token with the Workers KV Storage permission. It is shown only once (= `CF_API_TOKEN`) — store it safely.

> [!CAUTION]
>
> A leaked token is a serious risk. Protect it carefully.

### 3. One token on the GitHub side

- **`REPOS_PAT`** (fine-grained token: Contents read-only + Metadata read-only; Repository access: All repositories so future repos are covered): used by central indexing to read file trees and snapshot the repository list (private repos included). Create it at <https://github.com/settings/personal-access-tokens/new>. Note: the default Actions `GITHUB_TOKEN` can only read this repository, so cross-repo reads require this secret.

> [!CAUTION]
>
> A leaked token is a serious risk. Protect it carefully.

### 4. Indexing (zero config)

The central workflow (`.github/workflows/central-index.yml`) generates every index — **no per-repo configuration**:

- Auto-discovery: scans all repositories at the top of every hour (archived/disabled skipped), compares branch SHAs, and processes only changed repositories; the rest are skipped without any per-repo output.
- Blocklist: add one `owner/repo` line to `repos-blocklist.txt` to exclude a repository.
- Manual runs: Actions → Central Repository Index → Run workflow (optionally a single repo, or a dry-run preview that only reports counts).
- Cleanup: indexes of deleted repositories are pruned automatically. The first run backfills everything; later runs are incremental.

### 5. Worker secrets and a smoke test

![Cloudflare secrets location](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-8.png)

In Workers → Settings → Variables, add `USER` (username) and `PSWD` (password), both as "secret" type. Save, then deploy.

Smoke test: ① the home page loads and login works ② a keyword returns results ③ the index count matches the repository count. New repositories are discovered automatically — no redeploy needed. Note the repo list is an hourly snapshot (not real-time): renames and additions appear after the next sync.

## Features

- **Pinyin and fuzzy search**: remember just a keyword from a filename and fuzzy-find any file. "Search by path" is on by default, so even when the keyword is not in the filename itself, a well-organized path still matches.
- **Fast**: Cloudflare Workers with Cloudflare KV make search quick. Cloudflare's global CDN keeps the page itself fast, and Cloudflare-to-GitHub request latency is ideal.
- **Strictly private**: HTTPS-authenticated (Hono Basic Auth). Only someone who has both the username and password from the Cloudflare secrets can access it (usually just you). Rotate them in the Cloudflare dashboard whenever you like. Authentication guards the entire root path — without it, neither pages nor API assets are reachable, which eliminates the attack surface entirely.

## Architecture

### Central Index Workflow

An automation workflow in this repository (`.github/workflows/central-index.yml` + `scripts/generate_index.mjs`, zero dependencies, using the fetch built into Node 24).

Every hour (or on manual dispatch) it scans all repositories, compares branch SHAs against the KV record, pulls file trees and merges the global index only for changed repositories, writes it into Cloudflare KV, and prunes indexes of deleted repositories.

KV key layout (all intentional):

- `{repo-short-name}-index` — per-repository index
- `repo-info-cache` — repository list snapshot, rewritten hourly by central indexing (the Worker only reads it)
- `__meta-sha-table` — branch SHA table for change detection

### Internationalization

UI strings follow the VS Code l10n conventions: English source strings are the keys, and translations live in `l10n/bundle.l10n.json` (English identity map) plus `l10n/bundle.l10n.<locale>.json` (e.g. `zh-cn`). Components translate through i18next / react-i18next, configured for flat English keys and `{0}`-style placeholders; the browser language is detected automatically and a manual choice is remembered.

When you add or edit a visible string: wrap it with `t("...")`, add the key to every bundle, then run `pnpm l10n:sort`. The test suite enforces that all locales share the same key set with matching `{n}` placeholders.

## Development

```bash
pnpm install        # install dependencies
pnpm dev:client     # frontend dev server (Vite)
pnpm dev            # Worker dev server (requires wrangler login)
pnpm check          # gate: format check + typecheck + tests + build
pnpm test           # unit tests (Vitest, pure-logic seeds)
pnpm l10n:sort      # sort /l10n bundles by key
pnpm format         # Prettier across the repo (incl. Tailwind class order)
pnpm deploy         # build the frontend and deploy the Worker
```

Run `pnpm check` before committing; CI (`.github/workflows/check.yml`) runs the same gate on push/PR.

## Stats

[![Star History Chart](https://api.star-history.com/chart?repos=jy-eggroll/repodex&type=date&legend=top-left)](https://www.star-history.com/?repos=jy-eggroll%2Frepodex&type=date&legend=top-left)

## Acknowledgments

- Cloudflare for Workers, Git integration, KV, and the free tier that makes this project possible.
- [text-search-engine](https://github.com/cjinhuo/text-search-engine) — a mature search engine with great compatibility and performance, supporting pinyin and fuzzy search.
- [Hono](https://github.com/honojs) — the fastest framework on Cloudflare, providing strict, secure authentication.
- [Kumo](https://kumo-ui.com) — Cloudflare's official React component library, providing consistent UI and accessibility.
- [React](https://react.dev), [Vite](https://vite.dev), and [Tailwind CSS v4](https://tailwindcss.com) — the frontend build and styling foundation.
- [i18next](https://www.i18next.com) / [react-i18next](https://react.i18next.com) — the i18n runtime; the bundle layout follows VS Code's l10n conventions.
