import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Tabs, Button, DropdownMenu } from "@cloudflare/kumo";
import { Sun, Moon, Desktop, GithubLogo, Translate } from "@phosphor-icons/react";
import RepoList from "./components/RepoList";
import Search from "./components/Search";
import { loadSetting, applyTheme, subscribeSystem, type ThemeSetting } from "./theme";
import i18n, {
  applyLanguage,
  loadLanguageSetting,
  subscribeSystemLanguage,
  type LanguageSetting,
  type Locale,
} from "./i18n";
import { CONTENT_MAX_W, SHELL_PADDING, PANEL, HEADER_SHADOW, CONTENT_SHADOW } from "./ui";
import { DEMO } from "./api";

const THEME_META: Record<ThemeSetting, { icon: typeof Sun; labelKey: string }> = {
  auto: { icon: Desktop, labelKey: "Follow system" },
  light: { icon: Sun, labelKey: "Light" },
  dark: { icon: Moon, labelKey: "Dark" },
};

const LANGUAGE_OPTIONS: LanguageSetting[] = ["auto", "en", "zh-cn"];
// Language endonyms stay literal; only "Follow system" is translated.
const LANGUAGE_ENDONYM: Record<Locale, string> = { en: "English", "zh-cn": "简体中文" };

function languageLabel(value: LanguageSetting, followSystem: string): string {
  return value === "auto" ? followSystem : LANGUAGE_ENDONYM[value];
}

function ThemeMenuItem({
  value,
  current,
  onSelect,
}: {
  value: ThemeSetting;
  current: ThemeSetting;
  onSelect: (v: ThemeSetting) => void;
}) {
  const { t } = useTranslation();
  const { icon: Icon, labelKey } = THEME_META[value];
  // Pass the component reference (not an <Icon /> element); only then does Kumo inject mr-2 h-4 w-4 to space the icon from the text
  return (
    <DropdownMenu.Item icon={Icon} selected={value === current} onClick={() => onSelect(value)}>
      {t(labelKey)}
    </DropdownMenu.Item>
  );
}

function LanguageMenuItem({
  value,
  current,
  onSelect,
}: {
  value: LanguageSetting;
  current: LanguageSetting;
  onSelect: (v: LanguageSetting) => void;
}) {
  const { t } = useTranslation();
  return (
    <DropdownMenu.Item icon={Translate} selected={value === current} onClick={() => onSelect(value)}>
      {languageLabel(value, t("Follow system"))}
    </DropdownMenu.Item>
  );
}

export default function App() {
  const { t } = useTranslation();
  const [tab, setTab] = useState("search");
  const [setting, setSetting] = useState<ThemeSetting>("auto");
  const [lang, setLang] = useState<LanguageSetting>(loadLanguageSetting);

  useEffect(() => {
    const saved = loadSetting();
    setSetting(saved);
    applyTheme(saved);
    return subscribeSystem(() => applyTheme(loadSetting()));
  }, []);

  // In auto mode follow browser language changes; explicit choices stay pinned.
  useEffect(() => {
    if (lang !== "auto") return;
    return subscribeSystemLanguage(() => void i18n.changeLanguage());
  }, [lang]);

  function selectTheme(next: ThemeSetting) {
    setSetting(next);
    applyTheme(next);
  }

  function selectLanguage(next: LanguageSetting) {
    setLang(next);
    applyLanguage(next);
  }

  const ThemeIcon = THEME_META[setting].icon;
  const themeLabel = t(THEME_META[setting].labelKey);
  const langLabel = languageLabel(lang, t("Follow system"));

  return (
    <div className="bg-kumo-tint text-kumo-default min-h-screen antialiased">
      {DEMO && (
        <div className="bg-kumo-info-tint text-kumo-strong px-4 py-2 text-center text-sm">
          {t("Demo mode: data is fictional, search logic matches the production version")}
        </div>
      )}
      <div className={`mx-auto ${CONTENT_MAX_W}`}>
        {/* No z-index: Kumo dialogs portal to the end of body and cover the page; z-index here would cover the dialogs instead */}
        <div
          className={`${PANEL} sticky top-4 mb-6 flex flex-wrap items-center justify-between gap-2 px-4 py-3 ${HEADER_SHADOW}`}
        >
          <div className="flex items-center gap-1">
            <button
              className="text-kumo-strong px-2 text-lg font-semibold sm:text-xl"
              onClick={() => setTab("repos")}
            >
              RepoDex
            </button>
            <Button
              variant="ghost"
              shape="square"
              aria-label={t("GitHub repository")}
              title={t("GitHub repository")}
              icon={<GithubLogo />}
              onClick={() =>
                window.open("https://github.com/Jy-EggRoll/repodex", "_blank", "noopener,noreferrer")
              }
            />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Tabs
              className="header-tabs"
              variant="segmented"
              size="sm"
              value={tab}
              onValueChange={setTab}
              tabs={[
                { value: "search", label: t("File Search") },
                { value: "repos", label: t("Repositories") },
              ]}
            />
            <DropdownMenu>
              <DropdownMenu.Trigger
                render={(p) => (
                  <Button
                    {...p}
                    variant="ghost"
                    shape="square"
                    aria-label={t("Switch language (current: {0})", { 0: langLabel })}
                    title={langLabel}
                    icon={<Translate />}
                  />
                )}
              />
              <DropdownMenu.Content className="theme-menu-pop">
                {LANGUAGE_OPTIONS.map((v) => (
                  <LanguageMenuItem key={v} value={v} current={lang} onSelect={selectLanguage} />
                ))}
              </DropdownMenu.Content>
            </DropdownMenu>
            <DropdownMenu>
              <DropdownMenu.Trigger
                render={(p) => (
                  <Button
                    {...p}
                    variant="ghost"
                    shape="square"
                    aria-label={t("Switch theme (current: {0})", { 0: themeLabel })}
                    title={themeLabel}
                    icon={
                      <span key={setting} className="theme-icon-swap flex items-center">
                        <ThemeIcon />
                      </span>
                    }
                  />
                )}
              />
              <DropdownMenu.Content className="theme-menu-pop">
                {(Object.keys(THEME_META) as ThemeSetting[]).map((v) => (
                  <ThemeMenuItem key={v} value={v} current={setting} onSelect={selectTheme} />
                ))}
              </DropdownMenu.Content>
            </DropdownMenu>
          </div>
        </div>

        <div className={`${PANEL} ${SHELL_PADDING} ${CONTENT_SHADOW}`}>
          {/* Keyed per tab: switching remounts the panel so it replays the enter animation.
              Opacity only — card-enter's scale would slide this page-sized box's title on every switch */}
          <div key={tab} className="panel-enter">
            {tab === "repos" ? <RepoList /> : <Search />}
          </div>
        </div>

        <footer className="text-kumo-subtle mt-6 pb-2 text-center text-xs">
          <div>© {new Date().getFullYear()} Jy-EggRoll · GPL-3.0</div>
          <div className="mt-1">Powered by Cloudflare Workers · Kumo</div>
        </footer>
      </div>
    </div>
  );
}
