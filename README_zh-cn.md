# RepoDex

[![Check](https://github.com/Jy-EggRoll/repodex/actions/workflows/check.yml/badge.svg)](https://github.com/Jy-EggRoll/repodex/actions/workflows/check.yml)

[English](./README.md) | 简体中文

RepoDex（Repository Index，即仓库索引）是一套**跨仓库、跨分支的多维度模糊搜索系统**，基于 GitHub Actions、Cloudflare Workers 与 React + Vite + Kumo 前端构建。

- 在线试用（演示数据为虚构样例，搜索逻辑与正式版一致）：[RepoDex Demo](https://jy-eggroll.github.io/repodex/)
- 博客文章：[项目介绍-RepoDex](https://eggroll.pages.dev/p/项目介绍-repodex/)

本项目以**易配置、零成本**为设计目标，正常使用下，用量**远低于** GitHub Actions 与 Cloudflare 的免费额度。您可以放心按本文流程部署，不会产生任何费用。

## 为什么要开发此项目

日常开发中，开发者会在 GitHub 上创建大量仓库，其中包含各种代码文件、文档资料与资源文件。GitHub 本身缺少**跨仓库、跨分支的全局文件搜索能力**，查找文件因此十分不便。

对中文用户而言还有一层不便：这些文件里有不少中文文件名，而 GitHub 不支持拼音模糊搜索，检索效率因此更低。

为此我开发了本项目，希望提升用户在 GitHub 上的文件检索效率。

## 项目效果速览

### 移动端适配

![移动端](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/移动端.png)

上图使用“按名称搜索”，可以看出中英文、全拼、简拼的匹配效果。

![选择索引](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/选择索引.png)

索引可以多选，默认全选。弹窗内支持即时筛选索引名，并可一键全选 / 反选 / 清除；已有搜索关键词时，切换选项会立即重新搜索。搜索需要手动提交（回车或按钮），结果每页 100 条，向下滚动会自动加载更多，最多 1000 条；匹配集过大时只对前 1000 条计分，总数显示为约数，以此保证请求不会超时。

### 美观的宽屏布局

![宽屏](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/宽屏.png)

仓库的体积标签分为三档：`>900MB` 为危险，`800~900MB` 为警告，`<800MB` 为安全。不建议存放超过 1GB 的仓库，原因很多，此处不再展开。

### 其他特点

- 不论是仓库还是文件，都支持点击直达 GitHub。
- 文件默认覆盖所有分支（由索引决定）。
- 主题三档可切（跟随系统 / 浅色 / 深色，默认跟随系统，手动选择会被记住）。
- 界面中英双语（自动识别浏览器语言，可手动切换并记住选择）。所有可见字符串都经过 l10n 包装（VS Code l10n 风格：英文原文作 key，文案包位于 `/l10n`）。

## 部署指南

只需要一个 Cloudflare 账号（无需绑卡），按以下 5 步操作即可上线。全部密钥共 6 个，先看总览（细则见各步）：

| Secret            | 配在哪里                 | 用途                                              |
| ----------------- | ------------------------ | ------------------------------------------------- |
| `CF_ACCOUNT_ID`   | 本仓库 Actions Secrets   | Cloudflare 账号 ID（KV API 用）                   |
| `CF_NAMESPACE_ID` | 本仓库 Actions Secrets   | 中央索引写入的 KV（须与 Worker 绑定同一个）       |
| `CF_API_TOKEN`    | 本仓库 Actions Secrets   | 写 KV（需 Workers KV Storage 写权限）             |
| `REPOS_PAT`       | 本仓库 Actions Secrets   | 中央索引读取仓库文件树（经典 token，`repo` 权限） |
| `USER` / `PSWD`   | Workers 变量（选“密钥”） | 站点登录                                          |

### 1. Fork 与绑定

![Fork](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image.png)

如果本项目对您有帮助，欢迎点一个 star。

![创建流程](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-1.png)

复制 Account ID（= `CF_ACCOUNT_ID`）。

![连接-GitHub](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-2.png)

连接到 GitHub，按提示完成授权，并选择自己 Fork 的仓库。

> [!IMPORTANT]
>
> 构建命令填 `pnpm build`，部署命令填 `npx wrangler deploy`。漏填构建命令会导致部署失败（产物目录 `dist/` 已在 `wrangler.jsonc` 中配好，无需再指定输出目录）。

### 2. Cloudflare 侧：KV 与令牌

![创建-KV](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-3.png)

KV 无需手动创建：`wrangler.jsonc` 里的 `kv_namespaces` 绑定刻意不写 `id`，交由 Wrangler 在首次部署时自动创建命名空间，名称以 Worker 名为前缀（形如 `repodex-repo-index-kv`），之后的部署会复用同一个，不会重复新建。部署完成后进入 Workers & Pages → KV，按该名称找到它并复制 ID（= `CF_NAMESPACE_ID`）。由于部署在 Cloudflare 的构建环境（CI）中执行，Wrangler 不会把自动生成的 id 写回仓库，需要您手动复制到 Actions Secrets。

> [!NOTE]
>
> `CF_NAMESPACE_ID` 必须与 Worker 实际绑定的命名空间一致，否则中央索引写入 A、Worker 读取 B，搜索会一直返回 `index not ready`。如果首次部署没有自动创建 KV，可以手动新建一个，再在 Cloudflare 后台把 Worker 的 KV 绑定指向它，并同步填入 `CF_NAMESPACE_ID`。请不要把 ID 写回仓库里的绑定：那会把账号 ID 固化进每个 fork，违背此处刻意不写 `id` 的设计。

![创建令牌](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-4.png)

按图创建拥有 Workers KV Storage 权限的令牌，它只展示一次（= `CF_API_TOKEN`），请妥善保存。

> [!CAUTION]
>
> 令牌一旦泄露风险极高，请务必妥善保护。

### 3. GitHub 侧一个 Token

- **`REPOS_PAT`**（经典 token，勾选 `repo` 权限——细粒度 token 无法读取协作仓库）：供中央索引读取各仓库文件树，并同时生成仓库列表快照，涵盖个人仓库、组织仓库与您作为 collaborator 的仓库（含私有）。地址：<https://github.com/settings/tokens/new>。注意：Actions 默认的 `GITHUB_TOKEN` 只能读取本仓库，跨仓库读取必须配置此项。

> [!NOTE]
>
> 部分组织会禁用经典 token（需在组织设置中放行）；启用 SAML 的组织需要对 token 做一次性授权。经典 `repo` 权限是读写权限，请仅存放在 Actions Secrets 中，并定期轮换。

> [!CAUTION]
>
> 令牌一旦泄露风险极高，请务必妥善保护。

### 4. 索引接入（零配置）

中央工作流（`.github/workflows/central-index.yml`）统一生成索引，**各仓库无需任何配置**：

- 自动发现：每小时 42 分扫描您的全部仓库（刻意避开整点，此时 GitHub runner 的竞争更小；涵盖个人、组织与协作仓库，归档或已禁用的跳过），对比分支 SHA，只处理有变化的仓库，无变化则直接跳过（不输出仓库名）。该工作流在任意分支 push 时也会触发。
- 黑名单：在 `repos-blocklist.txt` 中加一行 `owner/repo` 即可排除。
- 手动补跑：Actions → Central Repository Index → Run workflow（可指定单个仓库，也可只做 dry-run 并输出统计预览）。
- 删库清理：仓库删除后，其索引 key 会自动清理。首次运行全量回填，之后为增量更新。

### 5. Worker 密钥与上线验证

![Cloudflare-机密位置](https://raw.githubusercontent.com/Jy-EggRoll/repodex/refs/heads/main/readme_img/image-8.png)

在 Workers → Settings → Variables 中添加（类型选“密钥”）：`USER`（登录用户名）、`PSWD`（登录密码）。保存后点击部署。

上线验证清单：① 首页能打开并登录 ② 搜索关键词能出结果 ③ 索引数与仓库数对得上。新仓库会被自动发现，无需重新部署。注意仓库列表是每小时快照（并非实时），改名或新增后需等下一次同步生效。

## 项目优点速览

- **拼音搜索与模糊搜索**：您只需要记得文件名中的部分关键词，就可以模糊查找到任何文件。默认启用“以路径搜索”，即使关键词没有出现在文件名中，只要分类合理、关键词体现在路径里，同样可以搜到文件。
- **高性能**：Cloudflare Workers 配合 Cloudflare KV，搜索速度很快。同时受益于 Cloudflare 覆盖全球的 CDN，网页本身的访问速度也不慢；Cloudflare 向 GitHub 发起请求的速度也比较理想。
- **私密性极强**：采用 HTTPS 加密鉴权（Hono 框架），只有同时拿到 Cloudflare 机密中用户名与密码的人才能访问（通常就是您自己）。若担心用户名与密码同时泄露，可以随时在 Cloudflare 后台更改。本项目直接保护网站根路径，未授权时无法访问任何 API 与页面资源，攻击面因此大幅缩小。

## 核心组件

### 中央索引工作流

一套运行在本仓库的自动化工作流（`.github/workflows/central-index.yml` + `scripts/generate_index.mjs`，零依赖，使用 Node 24 内置的 fetch）。

工作流的任务：

每小时 42 分（刻意避开整点；或手动触发）扫描名下所有仓库，对比 KV 中记录的分支 SHA，只对有变化的仓库拉取文件树、生成统一的全局索引并推送至 Cloudflare KV 存储，同时清理已删除仓库的残留索引（旧版索引格式的残留 key 也会一并清掉）。

搜索由 Durable Object 执行（Durable Object 每次请求的 CPU 预算为 30 秒，取代了免费版普通 Worker 的 10 毫秒上限），按批加载索引分片——索引规模不再引发 503。

KV 中的 key 布局（均为有意设计）：

- `__meta-plan`：分片清单 + 仓库列表，Worker 读取的唯一权威来源（搜索与索引列表）
- `{owner}/{repo}@{i}`：仓库索引分片（每片最多 20000 条，不跨仓库、不跨分支混装）
- `repo-info-cache`：仓库列表快照，每小时由中央索引覆盖，Worker 只读
- `__meta-sha-table`：分支 SHA 记录表，用于变化检测

### 国际化（l10n）

界面文案遵循 VS Code l10n 约定：英文原文作 key，翻译位于 `l10n/bundle.l10n.json`（英文基准）与 `l10n/bundle.l10n.<locale>.json`（如 `zh-cn`）。组件通过 i18next / react-i18next 取词，配置为扁平英文 key 与 `{0}` 占位符；浏览器语言自动识别，手动选择会被记住。

新增或修改可见字符串时：用 `t("...")` 包裹，在所有文案包中补齐 key，然后运行 `pnpm l10n:sort`。测试套件会校验各语言 key 集合一致、`{n}` 占位符一一对应。服务端错误码同样是翻译键——它们集中在 `ERROR_CODES`（`src/types.ts`），测试会遍历该表，所以只加错误码、不补译文会直接导致测试失败。要把这套方案复用到其他仓库，见 [docs/l10n-checklist.zh-cn.md](./docs/l10n-checklist.zh-cn.md)。

## 本地开发与工程化

```bash
pnpm install        # 安装依赖
pnpm dev:client     # 前端本地开发（Vite）
pnpm dev            # Worker 本地开发（需 wrangler 登录）
pnpm check          # 完整检查：生成类型 + 格式化 + 类型检查 + 测试 + 构建
pnpm test           # 单元测试（Vitest，纯逻辑，无需浏览器环境）
pnpm l10n:sort      # 按 key 排序 /l10n 文案包
pnpm format         # Prettier 全仓格式化（含 Tailwind 类序）
pnpm deploy         # 构建前端并部署 Worker
```

提交前跑一遍 `pnpm check`；CI（`.github/workflows/check.yml`）会在 push/PR 时自动跑同一套。

## 统计

[![RepoStars](https://repostars.dev/api/embed?repo=Jy-EggRoll%2Frepodex&theme=light)](https://repostars.dev/?repos=Jy-EggRoll%2Frepodex&theme=light)

## 鸣谢

- Cloudflare，提供 Workers、Git 集成、KV 等核心功能。
- <https://github.com/cjinhuo/text-search-engine> text-search-engine，成熟的搜索器，兼容性好、性能高，支持拼音与模糊搜索。
- <https://github.com/honojs> Hono，提供 Cloudflare 上的快速响应与严格的安全认证。
- <https://kumo-ui.com> Kumo，Cloudflare 官方 React 组件库，为前端提供一致的 UI 与无障碍支持。
- <https://react.dev> React、<https://vite.dev> Vite 与 <https://tailwindcss.com> Tailwind CSS v4，构成前端构建与样式基础。
- <https://www.i18next.com> i18next / <https://react.i18next.com> react-i18next，提供 i18n 运行时；文案包布局参考 VS Code l10n 约定。
