/** 演示数据合成器：纯函数，固定种子保证每次输出相同，可单测、无 DOM 依赖。 */

export interface DemoFile {
  name: string;
  path: string;
  size: number;
}

export interface DemoDir {
  name: string;
  path: string;
}

export interface DemoBranch {
  branch_name: string;
  files: DemoFile[];
  directories: DemoDir[];
}

export interface DemoRepo {
  repository: string;
  repository_short_name: string;
  /** 仓库体积（KB），与后端 GitHub API 的 size 单位一致 */
  sizeKb: number;
  branches: DemoBranch[];
}

/** 确定性 PRNG（mulberry32），同一种子同输出。 */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EN_DIRS = ["src", "docs", "scripts", "assets", "tests", ".github/workflows"];
const EN_WORDS = [
  "index",
  "search",
  "config",
  "worker",
  "utils",
  "readme",
  "changelog",
  "deploy",
  "cache",
  "api",
];
const EN_EXTS = ["ts", "js", "md", "yml", "json"];
const CN_WORDS = ["报告", "方案", "纪要", "合同", "手册", "计划", "总结", "规范", "申请", "通知"];
const CN_EXTS = ["md", "docx", "txt"];
const CN_DIRS = ["文档", "资料", "归档"];

interface RepoProfile {
  full: string;
  short: string;
  branches: string[];
  n: number;
  /** 仓库体积（KB），驱动大小列与风险徽章 */
  sizeKb: number;
  /** 单文件体积上限（bytes） */
  fileMax: number;
}

const REPOS: RepoProfile[] = [
  {
    full: "repodex-demo/demo-tiny",
    short: "demo-tiny",
    branches: ["main"],
    n: 15,
    sizeKb: 30 * 1024,
    fileMax: 200 * 1024,
  },
  {
    full: "repodex-demo/demo-code",
    short: "demo-code",
    branches: ["main", "dev"],
    n: 140,
    sizeKb: 700 * 1024,
    fileMax: 2 * 1024 * 1024,
  },
  {
    full: "repodex-demo/demo-docs",
    short: "demo-docs",
    branches: ["main"],
    n: 120,
    sizeKb: 500 * 1024,
    fileMax: 5 * 1024 * 1024,
  },
  {
    full: "repodex-demo/demo-media",
    short: "demo-media",
    branches: ["main"],
    n: 80,
    sizeKb: 850 * 1024,
    fileMax: 50 * 1024 * 1024,
  },
  {
    full: "repodex-demo/demo-large",
    short: "demo-large",
    branches: ["main", "dev"],
    n: 400,
    sizeKb: 1536 * 1024,
    fileMax: 100 * 1024 * 1024,
  },
];

const BIG_ARCHIVES = ["dataset-2024.zip", "assets-backup.zip"];

export const DEMO_SEED = 20260910;

export function buildDemoCorpus(seed: number = DEMO_SEED): DemoRepo[] {
  const rand = rng(seed);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

  return REPOS.map((repo) => ({
    repository: repo.full,
    repository_short_name: repo.short,
    sizeKb: repo.sizeKb,
    branches: repo.branches.map((branch_name) => {
      const files: DemoFile[] = [];
      const dirSet = new Set<string>();
      for (let i = 0; i < repo.n; i++) {
        const useCn = rand() < 0.4;
        const dir = useCn && rand() < 0.5 ? pick(CN_DIRS) : pick(EN_DIRS);
        const name = useCn
          ? `${pick(CN_WORDS)}-${String(Math.floor(rand() * 900) + 100)}.${pick(CN_EXTS)}`
          : `${pick(EN_WORDS)}-${i}.${pick(EN_EXTS)}`;
        const path = `${dir}/${name}`;
        dirSet.add(dir);
        files.push({ name, path: `./${path}`, size: Math.floor(rand() * repo.fileMax) });
      }
      if (repo.short === "demo-large") {
        for (const archive of BIG_ARCHIVES) {
          files.push({ name: archive, path: `./assets/${archive}`, size: 80 * 1024 * 1024 });
          dirSet.add("assets");
        }
      }
      const directories: DemoDir[] = [...dirSet].map((d) => ({ name: d, path: `./${d}` }));
      return { branch_name, files, directories };
    }),
  }));
}
