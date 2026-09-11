import { memo, startTransition, useEffect, useMemo, useRef, useState } from "react";
import { Button, Input, Switch, Checkbox, Badge, Dialog, Banner, Loader, Empty } from "@cloudflare/kumo";
import { Bug, X } from "@phosphor-icons/react";
import {
  ApiError,
  buildFileParam,
  fetchIndexList,
  searchFiles,
  type SearchPerf,
  type SearchResult,
} from "../api";
import { formatFileSize } from "../format";
import ResultCard from "./ResultCard";

const PAGE_SIZE = 100;

function titleHtml(item: SearchResult) {
  if (item.highlightedPath && item.highlightedPath !== "undefined") return item.highlightedPath;
  if (item.highlightedName && item.highlightedName !== "undefined") return item.highlightedName;
  return item.name || "";
}

const ResultRow = memo(function ResultRow({ item, index }: { item: SearchResult; index: number }) {
  return (
    <ResultCard
      href={item.github_url || "#"}
      titleHtml={titleHtml(item)}
      subtitle={`${item.repository || ""} / ${item.branch || ""} — ${item.path || ""}`}
      meta={formatFileSize(item)}
      enterDelayMs={Math.min(index % PAGE_SIZE, 11) * 40}
      badge={
        <Badge variant={item.type === "file" ? "info" : "primary"}>
          {item.type === "file" ? "文件" : "文件夹"}
        </Badge>
      }
    />
  );
});

export default function Search() {
  const [byName, setByName] = useState(false);
  const [indexes, setIndexes] = useState<string[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const [loadingIndexes, setLoadingIndexes] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [total, setTotal] = useState(0);
  const [fileCount, setFileCount] = useState(0);
  const [dirCount, setDirCount] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [perf, setPerf] = useState<SearchPerf | null>(null);
  const [debug, setDebug] = useState(() => {
    try {
      return localStorage.getItem("repodex-debug") === "1";
    } catch {
      return false;
    }
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  function toggleDebug() {
    setDebug((d) => {
      try {
        if (d) localStorage.removeItem("repodex-debug");
        else localStorage.setItem("repodex-debug", "1");
      } catch {
        // ignore
      }
      return !d;
    });
  }

  // 输入框非受控：敲字只走 DOM，不触发 React 渲染；搜索只由回车/按钮/切换手动触发
  const inputRef = useRef<HTMLInputElement>(null);
  // 单调请求序号：过期响应直接丢弃，保证结果收敛到最后一次提交
  const requestIdRef = useRef(0);

  useEffect(() => {
    async function loadIndexes() {
      setLoadingIndexes(true);
      try {
        const arr = await fetchIndexList();
        setIndexes(arr);
        setChecked((prev) => (prev.length === 0 ? arr : prev));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoadingIndexes(false);
      }
    }
    loadIndexes();
  }, []);

  // "/" 快捷键聚焦搜索框（已在输入框内则不劫持）
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function clearInput() {
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.focus();
    }
  }

  async function doSearch(q: string, list: string[], nameMode: boolean) {
    const v = q.trim();
    if (!v) return;
    const id = ++requestIdRef.current;
    setError("");
    setErrorStatus(null);
    setSearching(true);
    try {
      const tStart = performance.now();
      const data = await searchFiles(
        v,
        buildFileParam(list, indexes.length),
        nameMode ? "name" : "path",
        PAGE_SIZE,
        0,
      );
      if (id !== requestIdRef.current) return;
      setTotal(data.total);
      setFileCount(data.fileCount);
      setDirCount(data.dirCount);
      setPerf({ ...data, roundTripMs: Math.round(performance.now() - tStart) });
      startTransition(() => {
        setResults(data.results);
      });
    } catch (e) {
      if (id !== requestIdRef.current) return;
      setErrorStatus(e instanceof ApiError ? e.status : null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === requestIdRef.current) setSearching(false);
    }
  }

  function searchFromInput(list = checked, nameMode = byName) {
    void doSearch(inputRef.current?.value ?? "", list, nameMode);
  }

  // 无限滚动：滑到底自动申请下一页并追加
  async function loadMore() {
    if (results === null || loadingMore || searching) return;
    if (results.length >= total) return;
    const id = ++requestIdRef.current;
    setLoadingMore(true);
    try {
      const q = inputRef.current?.value ?? "";
      const data = await searchFiles(
        q,
        buildFileParam(checked, indexes.length),
        byName ? "name" : "path",
        PAGE_SIZE,
        results.length,
      );
      if (id !== requestIdRef.current) return;
      startTransition(() => {
        setResults((prev) => [...(prev ?? []), ...data.results]);
      });
    } catch (e) {
      if (id !== requestIdRef.current) return;
      setErrorStatus(e instanceof ApiError ? e.status : null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (id === requestIdRef.current) setLoadingMore(false);
    }
  }

  const hasMore = results !== null && results.length < total;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loadingMore || searching) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) void loadMore();
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, searching, results?.length]);

  function toggleOne(name: string, on: boolean) {
    const next = on ? [...checked, name] : checked.filter((v) => v !== name);
    setChecked(next);
    searchFromInput(next);
  }

  const [indexFilter, setIndexFilter] = useState("");
  const filteredIndexes = useMemo(() => {
    const kw = indexFilter.trim().toLowerCase();
    return kw ? indexes.filter((n) => n.toLowerCase().includes(kw)) : indexes;
  }, [indexes, indexFilter]);

  function selectAll() {
    const next = Array.from(new Set([...checked, ...filteredIndexes]));
    setChecked(next);
    searchFromInput(next);
  }

  function clearAll() {
    const next = checked.filter((n) => !filteredIndexes.includes(n));
    setChecked(next);
    searchFromInput(next);
  }

  function invertSelection() {
    const next = [
      ...checked.filter((n) => !filteredIndexes.includes(n)),
      ...filteredIndexes.filter((n) => !checked.includes(n)),
    ];
    setChecked(next);
    searchFromInput(next);
  }

  const countLabel = loadingIndexes
    ? "（请求索引中）"
    : checked.length === 0
      ? "（未选择）"
      : `（${checked.length} 已选）`;

  return (
    <section>
      <h1 className="text-kumo-strong mb-4 text-2xl font-bold">仓库文件搜索</h1>

      <div className="flex min-h-[56px] items-center gap-4">
        <Switch
          size="sm"
          label="按名称搜索"
          checked={byName}
          disabled={searching}
          onClick={() => {
            const next = !byName;
            setByName(next);
            searchFromInput(checked, next);
          }}
        />
        <span className="text-kumo-subtle text-xs">（默认按路径搜索）</span>
      </div>

      <div className="mt-2">
        <label className="text-kumo-strong mb-2 block font-medium">搜索（默认在所有索引中搜索）</label>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="flex w-full flex-1 gap-2">
            <div className="min-w-0 flex-1">
              <Input
                ref={inputRef}
                placeholder="输入关键字，回车或点击搜索（按 / 聚焦）"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !searching) searchFromInput();
                }}
              />
            </div>
            <Button
              variant="ghost"
              shape="square"
              aria-label="清空输入"
              title="清空输入"
              icon={<X />}
              onClick={clearInput}
            />
            <Button
              variant="primary"
              loading={searching}
              disabled={searching}
              onClick={() => searchFromInput()}
            >
              搜索
            </Button>
            <Button
              variant={debug ? "primary" : "ghost"}
              shape="square"
              aria-label="调试模式"
              aria-pressed={debug}
              title="调试模式：显示详细性能信息"
              icon={<Bug />}
              onClick={toggleDebug}
            />
          </div>
          <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
            <Dialog.Trigger
              render={(p) => (
                <Button {...p} variant="outline">
                  选择索引 <span className="text-kumo-subtle ml-2 text-sm">{countLabel}</span>
                </Button>
              )}
            />
            <Dialog size="xl" className="p-4 sm:p-6">
              <div className="mb-4 flex items-start justify-between gap-4">
                <Dialog.Title className="text-xl font-semibold">选择索引</Dialog.Title>
                <Dialog.Close
                  aria-label="Close"
                  render={(props) => (
                    <Button {...props} variant="secondary" shape="square" icon={<X />} aria-label="Close" />
                  )}
                />
              </div>
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <Input
                    placeholder="筛选索引…"
                    value={indexFilter}
                    onChange={(e) => setIndexFilter(e.target.value)}
                  />
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" size="sm" disabled={searching} onClick={selectAll}>
                    全选
                  </Button>
                  <Button variant="secondary" size="sm" disabled={searching} onClick={invertSelection}>
                    反选
                  </Button>
                  <Button variant="secondary" size="sm" disabled={searching} onClick={clearAll}>
                    清除
                  </Button>
                </div>
              </div>
              <div className="bg-kumo-base max-h-[60vh] overflow-auto rounded-lg p-2">
                {filteredIndexes.length === 0 ? (
                  <div className="text-kumo-subtle p-3 text-sm">无匹配索引</div>
                ) : (
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredIndexes.map((fname) => (
                      <div key={fname}>
                        <Checkbox
                          label={<span className="text-sm break-all">{fname}</span>}
                          checked={checked.includes(fname)}
                          disabled={searching}
                          onCheckedChange={(v) => toggleOne(fname, v === true)}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-8 flex justify-end gap-2">
                <Dialog.Close
                  render={(props) => (
                    <Button variant="primary" {...props}>
                      完成
                    </Button>
                  )}
                />
              </div>
            </Dialog>
          </Dialog.Root>
        </div>
      </div>

      {error && (
        <div className="mt-4">
          <Banner
            variant="error"
            title={`搜索失败${errorStatus ? `（${errorStatus}）` : ""}`}
            description={error}
          />
          <div className="mt-2">
            <Button variant="secondary" size="sm" disabled={searching} onClick={() => searchFromInput()}>
              重试
            </Button>
          </div>
        </div>
      )}
      {searching && (
        <div className="mt-4 flex items-center gap-2">
          <Loader size="sm" />
          <span className="text-kumo-subtle text-sm">搜索中</span>
        </div>
      )}

      <div className="mt-6">
        {results === null && !searching && !error && (
          <Empty title="输入关键词开始搜索" description="回车或点击搜索按钮，可按名称或路径匹配" />
        )}
        {results !== null && results.length === 0 && !searching && (
          <Empty title="未找到匹配" description="换个关键字或调整索引选择试试" />
        )}
        {results !== null && results.length > 0 && (
          <div>
            <h2 className="text-kumo-strong mb-2 text-lg font-semibold">
              匹配结果（共 {total}
              {perf?.truncated ? "+" : ""} 条 · {fileCount} 个文件 / {dirCount} 个文件夹）
            </h2>
            {debug && perf && (
              <div className="border-kumo-line bg-kumo-base mb-3 rounded-lg border p-3 font-mono text-xs">
                <div className="text-kumo-subtle">
                  服务端 {perf.tookMs}ms（取数 {perf.loadMs} / 匹配 {perf.searchMs}）
                </div>
                <div className="text-kumo-subtle mt-1">
                  网络来回 {perf.roundTripMs}ms · 返回 {results.length}/{total}
                </div>
                <div className="text-kumo-subtle mt-1">
                  索引 {perf.indexCount} 个 · 语料 {perf.itemsTotal} 条 · 加载失败 {perf.loadFailCount}
                </div>
              </div>
            )}
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {results.map((item, i) => (
                <ResultRow
                  key={`${item.repository}-${item.branch}-${item.path}-${item.type}-${i}`}
                  item={item}
                  index={i}
                />
              ))}
            </div>
            <div ref={sentinelRef} />
            {loadingMore && (
              <div className="mt-4 flex items-center justify-center gap-2">
                <Loader size="sm" />
                <span className="text-kumo-subtle text-sm">
                  加载更多（已显示 {results.length} / 共 {total}）
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
