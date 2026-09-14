/**
 * i18n setup based on i18next + react-i18next, following the VS Code l10n conventions:
 * English source strings are the keys, bundles live in /l10n, placeholders are {0}, {1}, ...
 */
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import bundleEn from "../../l10n/bundle.l10n.json";
import bundleZhCn from "../../l10n/bundle.l10n.zh-cn.json";

export const LOCALES = ["en", "zh-cn"] as const;
export type Locale = (typeof LOCALES)[number];
/** "auto" follows the browser language; an explicit locale pins the UI language. */
export type LanguageSetting = "auto" | Locale;

/** localStorage key shared with the detector and the bootstrap script in index.html. */
export const LANGUAGE_KEY = "lang";

/** Map any BCP-47 tag to a supported locale; Chinese variants fall back to zh-cn. */
export function normalizeLocale(tag: string | null | undefined): Locale {
  return tag && /^zh/i.test(tag) ? "zh-cn" : "en";
}

export function loadLanguageSetting(): LanguageSetting {
  try {
    const saved = localStorage.getItem(LANGUAGE_KEY);
    return saved === "en" || saved === "zh-cn" ? saved : "auto";
  } catch {
    return "auto";
  }
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: bundleEn },
      "zh-cn": { translation: bundleZhCn },
    },
    supportedLngs: [...LOCALES],
    fallbackLng: "en",
    // Keep codes lowercased ("zh-cn"), otherwise i18next normalizes to "zh-CN" and misses the bundle.
    lowerCaseLng: true,
    // English source strings are keys: disable namespace and nesting separators.
    keySeparator: false,
    nsSeparator: false,
    interpolation: { prefix: "{", suffix: "}", escapeValue: false },
    initAsync: false,
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LANGUAGE_KEY,
      // Persisting is handled by applyLanguage so "auto" leaves nothing stored.
      caches: [],
      convertDetectedLanguage: (lng: string) => normalizeLocale(lng),
    },
  });

/** Translate outside React components (data layer, module scope). */
export function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}

function syncDocument(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = locale === "zh-cn" ? "zh-CN" : "en";
  document.title = t("RepoDex – Repository info and file search");
  document
    .querySelector('meta[name="description"]')
    ?.setAttribute(
      "content",
      t(
        "RepoDex: fuzzy file search across GitHub repositories and branches, with pinyin and Chinese filename support.",
      ),
    );
}

/** Switch language and persist the choice; "auto" clears the stored preference. */
export function applyLanguage(setting: LanguageSetting): void {
  try {
    if (setting === "auto") localStorage.removeItem(LANGUAGE_KEY);
    else localStorage.setItem(LANGUAGE_KEY, setting);
  } catch {
    // ignore
  }
  void i18n.changeLanguage(setting === "auto" ? undefined : setting);
}

/** Subscribe to browser language changes; returns an unsubscribe function. */
export function subscribeSystemLanguage(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("languagechange", listener);
  return () => window.removeEventListener("languagechange", listener);
}

i18n.on("languageChanged", (lng) => syncDocument(normalizeLocale(lng)));
syncDocument(normalizeLocale(i18n.resolvedLanguage));

export default i18n;
