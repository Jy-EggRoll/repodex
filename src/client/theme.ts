export type ThemeMode = "light" | "dark";
export type ThemeSetting = "auto" | ThemeMode;

const KEY = "theme";

function migrate(old: string | null): ThemeSetting | null {
  if (old === "light" || old === "dark" || old === "auto") return old;
  if (old === "dim") return "dark";
  if (old === "cupcake") return "light";
  return null;
}

/** Pure function: saved setting + system preference -> effective mode; unit-testable. */
export function resolveMode(saved: ThemeSetting | null, systemDark: boolean): ThemeMode {
  if (saved === "light" || saved === "dark") return saved;
  return systemDark ? "dark" : "light";
}

export function systemDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function loadSetting(): ThemeSetting {
  try {
    return migrate(localStorage.getItem(KEY)) ?? "auto";
  } catch {
    return "auto";
  }
}

/** Subscribe to system theme changes; returns an unsubscribe function. */
export function subscribeSystem(listener: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => listener();
  query.addEventListener("change", handler);
  return () => query.removeEventListener("change", handler);
}

// Mobile browser top-bar color: the meta spec only accepts concrete colors, so use kumo-tint approximations
const THEME_COLOR: Record<ThemeMode, string> = { light: "#f5f5f5", dark: "#262626" };

export function applyTheme(setting: ThemeSetting): void {
  const mode = resolveMode(setting, systemDark());
  document.documentElement.setAttribute("data-theme", "kumo");
  document.documentElement.setAttribute("data-mode", mode);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEME_COLOR[mode]);
  try {
    localStorage.setItem(KEY, setting);
  } catch {
    // ignore
  }
}
