import { afterEach, describe, expect, it } from "vitest";
import i18n, { applyLanguage, normalizeLocale } from "./i18n";
import bundleEn from "../../l10n/bundle.l10n.json";
import bundleZhCn from "../../l10n/bundle.l10n.zh-cn.json";

const sourceModules = import.meta.glob(["./**/*.{ts,tsx}", "!./**/*.test.ts", "!./**/*.d.ts"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

function placeholders(text: string): string[] {
  return [...text.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort();
}

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("normalizeLocale", () => {
  it("maps Chinese tags to zh-cn", () => {
    expect(normalizeLocale("zh-CN")).toBe("zh-cn");
    expect(normalizeLocale("zh-TW")).toBe("zh-cn");
    expect(normalizeLocale("zh")).toBe("zh-cn");
  });

  it("maps everything else to en", () => {
    expect(normalizeLocale("en-US")).toBe("en");
    expect(normalizeLocale("fr")).toBe("en");
    expect(normalizeLocale(null)).toBe("en");
    expect(normalizeLocale(undefined)).toBe("en");
  });
});

describe("bundles", () => {
  it("keeps the same key set across locales", () => {
    expect(Object.keys(bundleZhCn).sort()).toEqual(Object.keys(bundleEn).sort());
  });

  it("uses identity values in the English bundle", () => {
    for (const [key, value] of Object.entries(bundleEn)) expect(value).toBe(key);
  });

  it("keeps {n} placeholders in sync between locales", () => {
    for (const [key, value] of Object.entries(bundleZhCn)) {
      expect(placeholders(value), key).toEqual(placeholders(key));
    }
  });

  it("references only keys that exist in the bundles", () => {
    const keys = new Set(Object.keys(bundleEn));
    const patterns = [/(?:^|[^\w$])t\(\s*"((?:[^"\\]|\\.)*)"/g, /labelKey:\s*"((?:[^"\\]|\\.)*)"/g];
    const missing: string[] = [];
    for (const [file, code] of Object.entries(sourceModules)) {
      for (const pattern of patterns) {
        for (const match of code.matchAll(pattern)) {
          if (!keys.has(match[1])) missing.push(`${file}: ${match[1]}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("translation", () => {
  it("interpolates positional placeholders", async () => {
    await i18n.changeLanguage("en");
    expect(i18n.t("({0} selected)", { 0: 3 })).toBe("(3 selected)");
    await i18n.changeLanguage("zh-cn");
    expect(i18n.t("({0} selected)", { 0: 3 })).toBe("（3 已选）");
  });

  it("translates server error codes", async () => {
    await i18n.changeLanguage("zh-cn");
    expect(i18n.t("empty query")).toBe("查询为空");
    expect(i18n.t("not found")).toBe("索引不存在或已被清理");
  });

  it("falls back to the key for unknown strings", async () => {
    await i18n.changeLanguage("zh-cn");
    expect(i18n.t("some untranslated string")).toBe("some untranslated string");
  });
});

describe("applyLanguage", () => {
  it("switches to explicit locales", () => {
    applyLanguage("zh-cn");
    expect(i18n.language).toBe("zh-cn");
    applyLanguage("en");
    expect(i18n.language).toBe("en");
  });

  it("resolves auto to a supported locale", async () => {
    applyLanguage("auto");
    await i18n.changeLanguage();
    expect(["en", "zh-cn"]).toContain(i18n.language);
  });
});
