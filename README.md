---
title: 项目介绍-repodex
description: 基于 GitHub Actions、Cloudflare Workers 和 React + Vite + Kumo 前端，实现了一套跨仓库、跨分支的多维度模糊搜索系统，以提升用户在 GitHub 上的文件检索效率。
date: 2026-01-16
lastmod: 2026-09-09
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

命名：RepositoryIndex——仓库索引聚合。

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

本项目支持选择索引，默认全选。选中或取消选中后会在短暂的防抖延时后自动刷新结果列表。

### 美观的宽屏布局

![宽屏](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/宽屏.png)

对于仓库显示的标签，`>900MB` 是危险，`800~900MB` 是警告，`<800MB` 是安全。用户不应该存储大于 1GB 的仓库，这其中有很多原因，此处不再赘述。

### 其他特点

- 不论是仓库还是文件，都支持点击直达 GitHub。
- 文件默认检测所有分支（事实上，这是由索引决定的）
- 主题切换（浅色 / 深色自动适配 Kumo 语义 token，偏好持久化到 localStorage）

## 项目优点速览

- **拼音搜索与模糊搜索**：用户只需要记得文件名中的一些关键词，就可以模糊查找到任何文件。默认启用“以路径搜索”，即使用户的关键词没有体现在文件名本身中，只要用户的分类是合理的，即关键词体现在路径中，也可以搜索到文件。
- **高性能**：Cloudflare Workers 配合 Cloudflare KV，搜索速度很快。此外，受益于 Cloudflare 自身在全球的强大 CDN，网页本身的访问速度也并不慢。从 Cloudflare 向 GitHub 发起请求的速度也比较理想。
- **私密性极强**：本项目可接入任意私有仓库，搜索前端页面采用 HTTPS 加密鉴权（Hono 框架），只有同时获得 Cloudflare 机密中用户名与密码的用户，才可以访问（通常也就是用户自己）。若用户担心用户名与密码同时泄露，可以随意在 Cloudflare 后台更改。本项目直接保护网站的根路径，在未授权情况下无法访问任何 api 与页面资源，这甚至杜绝了被攻击的风险。

## 先决条件

用户只需要一个 Cloudflare 账号，不需要绑定银行卡等复杂操作。

## 如何使用该项目

请自行先注册一个 Cloudflare 账号。地址：<https://dash.cloudflare.com/login>。

### Fork 本项目

![Fork](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image.png)

如果您愿意为本项目点一个 star，我将非常感激。

### 创建 Workers 并绑定到 GitHub

![创建流程](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-1.png)

请复制 Account ID 【信息 1】并记录到安全的地方，后续将使用该信息。

![连接-GitHub](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-2.png)

请连接到 GitHub，如需授权，请放心授权。连接后选择自己 Fork 的项目即可。

在构建设置中，构建命令填写 `pnpm build`（依赖安装由 Cloudflare 自动执行），部署命令保持 `npx wrangler deploy --minify`。前端构建产物输出到 `dist/`，已在 `wrangler.jsonc` 中配置，无需额外指定输出目录。

### 创建 Workers KV

![创建-KV](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-3.png)

请按照图中指示创建 KV，名称随意，刷新后点击 ID 即可复制 ID【信息 2】，请记录到安全的地方。

### 创建 Cloudflare Token

![创建令牌](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-4.png)

请按照图示创建拥有 Workers KV 存储权限的令牌。

令牌创建成功后只会展示一次，默认创建无限期令牌，请复制到安全的地方【信息 3】。

> [!CAUTION]
>
> 请注意：令牌泄露后风险极大，请务必妥善保护！

### 创建 GitHub Token

请注意，本步骤在 GitHub 上进行。

地址为 <https://github.com/settings/tokens>。

![GitHub-Token](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-9.png)

请按图中指引，创建拥有完整 repo 权限的 token，**可以选择永不过期，但是务必妥善保存**。创建后请复制【信息 4】。

> [!CAUTION]
>
> 请注意：令牌泄露后风险极大，请务必妥善保护！

### 仓库接入：中央索引（零配置）

索引由本仓库的中央工作流（`.github/workflows/central-index.yml`）统一生成，**各仓库无需配置任何 Secrets、无需添加任何文件**：

- 自动发现：每小时整点扫描名下所有仓库（归档/禁用自动跳过），只重新生成有变化的仓库，无变化零 clone 直接跳过。
- 黑名单：不想被索引的仓库，在本仓库根目录 `repos-blocklist.txt` 加一行 `owner/repo` 即可。
- 手动补跑：Actions 页 → Central Repository Index → Run workflow，可指定单个仓库、可 dry-run 预览。
- 删库清理：仓库删除后，其索引 key 会在下次同步时自动清理。
- 首次启用后第一次运行会全量 backfill，之后全是增量。

#### 中央仓库 Secrets（只需配一次）

在本仓库 Settings → Secrets and variables → Actions 中配置：

| Secret | 用途 | 获取方式 |
| --- | --- | --- |
| `REPOS_PAT` | 读取名下所有仓库的文件树。必须用细粒度 PAT：权限只开 Contents 只读 + Metadata 只读，Repository access 选 All repositories（覆盖未来新仓库）。注意：Actions 默认 `GITHUB_TOKEN` 只能读本仓库，跨仓读取必须配此项，不可省 | <https://github.com/settings/personal-access-tokens/new> |
| `CF_ACCOUNT_ID` | 同【信息 1】 | 见上文 |
| `CF_NAMESPACE_ID` | 同【信息 2】 | 见上文 |
| `CF_API_TOKEN` | 同【信息 3】，需 Workers KV Storage 写权限 | 见上文 |

> 如已有 `REPO_INFO_TOKEN`（经典 token，repo 全权限）也可临时复用为 `REPOS_PAT`，但权限过大，仅建议过渡期使用，长期请换细粒度只读 token。

#### 老接入方式（legacy）

各仓库之前配置的 3 个 Secrets + `generate-index-and-push.yml` 可继续保留，作为“推送即索引”的即时通道（KV 格式相同，不冲突）；也可直接删除改走中央定时。模板目录 `workflows/` 已移除，不再单独维护。

### 在 Cloudflare Workers 上需要配置的内容

本部分请注意，回到了 Cloudflare Workers 平台。

![Cloudflare-机密位置](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-8.png)

请添加以下机密，类型均为“密钥”：

- `USER`：您预期的的登录用户名
- `PSWD`：您预期的登录密码
- `REPO_INFO_TOKEN`：上文【信息 4】

添加完成后，请部署。

自此，项目已经完全部署完成。新仓库会被中央索引自动发现，网页不需要重新部署，会动态地获取新增的索引。

## 核心组件

### 中央索引工作流

一套运行在本仓库的自动化工作流（`.github/workflows/central-index.yml` + `scripts/generate_index.py`）。

工作流的任务：

每小时整点（或手动触发）扫描名下所有仓库，对比 KV 中记录的分支 SHA，只对有变化的仓库拉取文件树、生成统一的全局索引并推送至 Cloudflare KV 存储，同时清理已删除仓库的僵尸索引。

## 统计

[![Star History Chart](https://api.star-history.com/chart?repos=jy-eggroll/repodex&type=date&legend=top-left)](https://www.star-history.com/?repos=jy-eggroll%2Fmykeymap-enhance&type=date&legend=top-left)

## 鸣谢

- Cloudflare，提供 Workers、Git 集成、KV 等核心功能。
- <https://github.com/cjinhuo/text-search-engine> 一个相当成熟的搜索器，兼容性好，性能高，支持拼音、模糊搜索。
- <https://github.com/honojs> Hono 框架，为我的项目提供在 Cloudflare 上最快的速度和严密的安全认证。
- <https://kumo-ui.com> Kumo，Cloudflare 官方 React 组件库，为前端提供一致的 UI 与无障碍支持。
- <https://react.dev> React、<https://vite.dev> Vite 与 <https://tailwindcss.com> Tailwind CSS v4，构成前端构建与样式基础。
