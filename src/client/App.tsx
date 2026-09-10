import { useEffect, useState } from "react";
import { Tabs, Button, DropdownMenu } from "@cloudflare/kumo";
import { Sun, Moon, Desktop } from "@phosphor-icons/react";
import RepoList from "./components/RepoList";
import Search from "./components/Search";
import { loadSetting, applyTheme, subscribeSystem, type ThemeSetting } from "./theme";

const THEME_META: Record<ThemeSetting, { icon: typeof Sun; label: string }> = {
  auto: { icon: Desktop, label: "跟随系统" },
  light: { icon: Sun, label: "浅色" },
  dark: { icon: Moon, label: "深色" },
};

function ThemeMenuItem({
  value,
  current,
  onSelect,
}: {
  value: ThemeSetting;
  current: ThemeSetting;
  onSelect: (v: ThemeSetting) => void;
}) {
  const { icon: Icon, label } = THEME_META[value];
  return (
    <DropdownMenu.Item icon={<Icon />} selected={value === current} onClick={() => onSelect(value)}>
      {label}
    </DropdownMenu.Item>
  );
}

export default function App() {
  const [tab, setTab] = useState("repos");
  const [setting, setSetting] = useState<ThemeSetting>("auto");

  useEffect(() => {
    const saved = loadSetting();
    setSetting(saved);
    applyTheme(saved);
    return subscribeSystem(() => applyTheme(loadSetting()));
  }, []);

  function selectTheme(next: ThemeSetting) {
    setSetting(next);
    applyTheme(next);
  }

  const ThemeIcon = THEME_META[setting].icon;

  const isDemo = import.meta.env.VITE_DEMO === "1";

  return (
    <div className="bg-kumo-tint text-kumo-default min-h-screen antialiased">
      {isDemo && (
        <div className="bg-kumo-info-tint text-kumo-strong px-4 py-2 text-center text-sm">
          演示模式：数据为虚构样例，搜索逻辑与正式版一致
        </div>
      )}
      <div className="mx-auto max-w-5xl p-4 sm:p-6 xl:max-w-7xl">
        {/* 不加 z-index：Kumo 弹框靠 body 末尾 portal 压住页面，有 z-index 反而会盖住弹框 */}
        <div className="bg-kumo-base sticky top-4 mb-6 flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 shadow-sm">
          <button
            className="text-kumo-strong px-2 text-lg font-semibold sm:text-xl"
            onClick={() => setTab("repos")}
          >
            RepoDex
          </button>
          <div className="flex items-center gap-2">
            <Tabs
              variant="segmented"
              size="sm"
              value={tab}
              onValueChange={setTab}
              tabs={[
                { value: "repos", label: "仓库信息" },
                { value: "search", label: "文件搜索" },
              ]}
            />
            <DropdownMenu>
              <DropdownMenu.Trigger
                render={(p) => (
                  <Button
                    {...p}
                    variant="ghost"
                    shape="square"
                    aria-label={`切换主题（当前：${THEME_META[setting].label}）`}
                    title={THEME_META[setting].label}
                    icon={<ThemeIcon />}
                  />
                )}
              />
              <DropdownMenu.Content>
                {(Object.keys(THEME_META) as ThemeSetting[]).map((v) => (
                  <ThemeMenuItem key={v} value={v} current={setting} onSelect={selectTheme} />
                ))}
              </DropdownMenu.Content>
            </DropdownMenu>
          </div>
        </div>

        <div className="bg-kumo-base rounded-xl p-4 shadow-md sm:p-6">
          {tab === "repos" ? <RepoList /> : <Search />}
        </div>

        <footer className="text-kumo-subtle mt-6 pb-2 text-center text-xs">
          Powered by Cloudflare Workers · Kumo
        </footer>
      </div>
    </div>
  );
}
