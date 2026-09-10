export type ThemeMode = "light" | "dark";

const KEY = "theme";

function migrate(old: string | null): ThemeMode | null {
  if (old === "light" || old === "dark") return old;
  if (old === "dim") return "dark";
  if (old === "cupcake") return "light";
  return null;
}

export function loadTheme(): ThemeMode {
  try {
    const saved = migrate(localStorage.getItem(KEY));
    if (saved) return saved;
  } catch {
    // ignore
  }
  return "light";
}

// 移动端浏览器顶栏颜色：meta 规范只接受具体色值，此处取 kumo-tint 深浅近似值
const THEME_COLOR: Record<ThemeMode, string> = { light: "#f5f5f5", dark: "#262626" };

export function applyTheme(mode: ThemeMode) {
  document.documentElement.setAttribute("data-theme", "kumo");
  document.documentElement.setAttribute("data-mode", mode);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[mode]);
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // ignore
  }
}
