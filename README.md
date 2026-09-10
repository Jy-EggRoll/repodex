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

命名：RepositoryIndex——仓库索引聚合。

- 在线试用（演示数据为虚构样例，搜索逻辑与正式版一致）：[RepoDex Demo](https://jy-eggroll.github.io/repodex/)

- 博客文章链接（和 README 完全相同）：[项目介绍-RepoDex](https://eggroll.pages.dev/p/项目介绍-repodex/)

## 为什么要开发此项目

在日常开发中，开发者在 GitHub 上建立了大量的仓库，其中有各种代码文件、文档资料、资源文件等。GitHub 本身缺少**跨仓库、跨分支的全局文件搜索能力**，这给开发者带来了诸多不便。

此外，对于中文用户，这些文件中不乏中文文件名的内容，GitHub 也不支持拼音模糊搜索，进一步限制了用户的检索效率。

为此，我开发了本项目，基于 GitHub Actions、Cloudflare Workers 和 React + Vite + Kumo 前端，实现了一套**跨仓库、跨分支的多维度模糊搜索系统**，以提升用户在 GitHub 上的文件检索效率。

本项目以**易配置、零成本**的思想开发，在正常使用情况下，**远不可能**达到 GitHub Actions 和 Cloudflare 的免费额度。您可以放心地按照本文流程部署项目，无须担心产生任何成本。

## 项目效果速览

### 移动端的优良适配

![移动端](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/移动端.png)

上图采用“按名称搜索”，您可以从中看出中英文、全拼、简拼的匹配效果。

![选择索引](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/选择索引.png)

本项目支持选择索引，默认全选。弹框内可即时筛选索引名，一键全选 / 反选 / 清除；切换选项后如有关键词会立即重搜。搜索为手动提交（回车或按钮），结果最多展示前 100 条；超大匹配集只取前 1000 计分，总数标约数，保证永不超时。

### 美观的宽屏布局

![宽屏](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/宽屏.png)

对于仓库显示的标签，`>900MB` 是危险，`800~900MB` 是警告，`<800MB` 是安全。用户不应该存储大于 1GB 的仓库，这其中有很多原因，此处不再赘述。

### 其他特点

- 不论是仓库还是文件，都支持点击直达 GitHub。
- 文件默认检测所有分支（事实上，这是由索引决定的）
- 主题三档可切（跟随系统 / 浅色 / 深色，默认跟随系统，手动选择会被记住）

## 部署指南

只需一个 Cloudflare 账号（无需绑卡），按下面 5 步走完即上线。全部密钥共 7 个，先总览（细则见各步）：

| Secret            | 配在哪里                 | 用途                                   |
| ----------------- | ------------------------ | -------------------------------------- |
| `CF_ACCOUNT_ID`   | 本仓库 Actions Secrets   | KV 地址                                |
| `CF_NAMESPACE_ID` | 本仓库 Actions Secrets   | KV 地址                                |
| `CF_API_TOKEN`    | 本仓库 Actions Secrets   | 写 KV（需 Workers KV Storage 写权限）  |
| `REPOS_PAT`       | 本仓库 Actions Secrets   | 中央索引读取仓库文件树（细粒度，只读） |
| `USER` / `PSWD`   | Workers 变量（选“密钥”） | 站点登录                               |
| `REPO_INFO_TOKEN` | Workers 变量（选“密钥”） | 后端列出你的仓库                       |

### 1. Fork 与绑定

![Fork](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image.png)

如果您愿意为本项目点一个 star，我将非常感激。

![创建流程](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-1.png)

复制 Account ID（= `CF_ACCOUNT_ID`）收好。

![连接-GitHub](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-2.png)

连接到 GitHub，如需授权请放心授权，选择自己 Fork 的项目。

> [!IMPORTANT]
>
> 构建设置：构建命令填 `pnpm build`，部署命令填 `npx wrangler deploy --minify`。漏掉构建命令会部署失败（产物目录 `dist/` 已在 `wrangler.jsonc` 配好，无需指定输出目录）。

### 2. Cloudflare 侧三项

![创建-KV](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-3.png)

按图创建 KV，名称随意，刷新后复制 ID（= `CF_NAMESPACE_ID`）。

![创建令牌](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-4.png)

按图创建拥有 Workers KV Storage 权限的令牌，只展示一次（= `CF_API_TOKEN`），妥善保存。

> [!CAUTION]
>
> 令牌泄露风险极大，务必妥善保护！

### 3. GitHub 侧两个 Token（分工不同，都要建）

- **`REPO_INFO_TOKEN`**（经典 token，repo 全权限）：给 Worker 后端调 GitHub API 列出你的仓库（含私有）。地址：<https://github.com/settings/tokens>，可设永不过期，妥善保存。
- **`REPOS_PAT`**（细粒度 token，只开 Contents 只读 + Metadata 只读，Repository access 选 All repositories，覆盖未来新仓库）：给中央索引读取各仓库文件树。地址：<https://github.com/settings/personal-access-tokens/new>。注意：Actions 默认 `GITHUB_TOKEN` 只能读本仓库，跨仓读取必须配此项。

> [!CAUTION]
>
> 令牌泄露风险极大，务必妥善保护！

### 4. 索引接入（零配置）

中央工作流（`.github/workflows/central-index.yml`）统一生成索引，**各仓库无需任何配置**：

- 自动发现：每小时整点扫描名下所有仓库（归档/禁用跳过），对比分支 SHA，只处理有变化的仓库，无变化直接跳过。
- 黑名单：`repos-blocklist.txt` 加一行 `owner/repo` 即可排除。
- 手动补跑：Actions → Central Repository Index → Run workflow（可指定单个仓库、可 dry-run 预览）。
- 删库清理：仓库删除后索引 key 自动清理。首次运行全量 backfill，之后增量。

### 5. Worker 密钥与上线验证

![Cloudflare-机密位置](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-8.png)

在 Workers → Settings → Variables 添加（类型选“密钥”）：`USER`（登录用户名）、`PSWD`（登录密码）、`REPO_INFO_TOKEN`（上一步的经典 token）。保存后点部署。

上线验证清单：① 首页能打开并登录 ② 搜关键词出结果 ③ 索引数与仓库数对得上。新仓库会被自动发现，无需重新部署。

## 项目优点速览

- **拼音搜索与模糊搜索**：用户只需要记得文件名中的一些关键词，就可以模糊查找到任何文件。默认启用“以路径搜索”，即使用户的关键词没有体现在文件名本身中，只要用户的分类是合理的，即关键词体现在路径中，也可以搜索到文件。
- **高性能**：Cloudflare Workers 配合 Cloudflare KV，搜索速度很快。此外，受益于 Cloudflare 自身在全球的强大 CDN，网页本身的访问速度也并不慢。从 Cloudflare 向 GitHub 发起请求的速度也比较理想。
- **私密性极强**：本项目可接入任意私有仓库，搜索前端页面采用 HTTPS 加密鉴权（Hono 框架），只有同时获得 Cloudflare 机密中用户名与密码的用户，才可以访问（通常也就是用户自己）。若用户担心用户名与密码同时泄露，可以随意在 Cloudflare 后台更改。本项目直接保护网站的根路径，在未授权情况下无法访问任何 api 与页面资源，这甚至杜绝了被攻击的风险。

## 核心组件

### 中央索引工作流

一套运行在本仓库的自动化工作流（`.github/workflows/central-index.yml` + `scripts/generate_index.mjs`，零依赖，Node 24 内置 fetch）。

工作流的任务：

每小时整点（或手动触发）扫描名下所有仓库，对比 KV 中记录的分支 SHA，只对有变化的仓库拉取文件树、生成统一的全局索引并推送至 Cloudflare KV 存储，同时清理已删除仓库的僵尸索引。

KV 中的 key 布局：`{仓库短名}-index`（仓库索引）、`repo-info-cache`（仓库列表缓存，10 分钟过期）、`__meta-sha-table`（分支 SHA 记录表，变化检测用，均非 bug）。

## 本地开发与工程化

```bash
pnpm install        # 安装依赖
pnpm dev:client     # 前端本地开发（Vite）
pnpm dev            # Worker 本地开发（需 wrangler 登录）
pnpm check          # 门禁：格式化检查 + 类型检查 + 测试 + 构建
pnpm test           # 单元测试（Vitest，纯逻辑种子）
pnpm format         # Prettier 全仓格式化（含 Tailwind 类序）
pnpm deploy         # 构建前端并部署 Worker
```

提交前跑一遍 `pnpm check`；CI（`.github/workflows/check.yml`）会在 push/PR 时自动跑同一套。

## 统计

[![Star History Chart](https://api.star-history.com/chart?repos=jy-eggroll/repodex&type=date&legend=top-left)](https://www.star-history.com/?repos=jy-eggroll%2Fmykeymap-enhance&type=date&legend=top-left)

## 鸣谢

- Cloudflare，提供 Workers、Git 集成、KV 等核心功能。
- <https://github.com/cjinhuo/text-search-engine> 一个相当成熟的搜索器，兼容性好，性能高，支持拼音、模糊搜索。
- <https://github.com/honojs> Hono 框架，为我的项目提供在 Cloudflare 上最快的速度和严密的安全认证。
- <https://kumo-ui.com> Kumo，Cloudflare 官方 React 组件库，为前端提供一致的 UI 与无障碍支持。
- <https://react.dev> React、<https://vite.dev> Vite 与 <https://tailwindcss.com> Tailwind CSS v4，构成前端构建与样式基础。
