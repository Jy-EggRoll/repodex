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

const REPOS = [
  { full: "repodex-demo/demo-code", short: "demo-code", branches: ["main", "dev"], n: 140 },
  { full: "repodex-demo/demo-docs", short: "demo-docs", branches: ["main"], n: 120 },
  { full: "repodex-demo/demo-media", short: "demo-media", branches: ["main"], n: 80 },
];

export const DEMO_SEED = 20260910;

export function buildDemoCorpus(seed: number = DEMO_SEED): DemoRepo[] {
  const rand = rng(seed);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)];

  return REPOS.map((repo) => ({
    repository: repo.full,
    repository_short_name: repo.short,
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
        files.push({ name, path: `./${path}`, size: Math.floor(rand() * 200000) });
      }
      const directories: DemoDir[] = [...dirSet].map((d) => ({ name: d, path: `./${d}` }));
      return { branch_name, files, directories };
    }),
  }));
}
