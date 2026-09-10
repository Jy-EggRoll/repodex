import { useEffect, useState } from "react";
import { Tabs, Button } from "@cloudflare/kumo";
import { Sun, Moon } from "@phosphor-icons/react";
import RepoList from "./components/RepoList";
import Search from "./components/Search";
import { loadTheme, applyTheme, type ThemeMode } from "./theme";

export default function App() {
  const [tab, setTab] = useState("repos");
  const [mode, setMode] = useState<ThemeMode>("light");

  useEffect(() => {
    const m = loadTheme();
    setMode(m);
    applyTheme(m);
  }, []);

  function toggleMode() {
    const next: ThemeMode = mode === "light" ? "dark" : "light";
    setMode(next);
    applyTheme(next);
  }

  return (
    <div className="bg-kumo-tint text-kumo-default min-h-screen antialiased">
      <div className="mx-auto max-w-5xl p-4 sm:p-6 xl:max-w-7xl">
        {/* 不加 z-index：Kumo 弹框靠 body 末尾 portal 压住页面，有 z-index 反而会盖住弹框 */}
        <div className="bg-kumo-base sticky top-4 mb-6 flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 shadow-sm">
          <button
            className="text-kumo-strong px-2 text-lg font-semibold sm:text-xl"
            onClick={() => setTab("repos")}
          >
            仓库信息
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
            <Button
              variant="ghost"
              shape="square"
              aria-label="切换主题"
              icon={mode === "light" ? <Moon /> : <Sun />}
              onClick={toggleMode}
            />
          </div>
        </div>

        <div className="bg-kumo-base rounded-xl p-4 shadow-md sm:p-6">
          {tab === "repos" ? <RepoList /> : <Search />}
        </div>
      </div>
    </div>
  );
}
