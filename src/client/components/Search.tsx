import { memo, startTransition, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button, Input, Switch, Checkbox, Badge, Dialog, Loader, Empty } from "@cloudflare/kumo";
import { Bug, X } from "@phosphor-icons/react";
import {
  PAGE_SIZE,
  PAGE_TITLE,
  RESULT_GRID,
  SCROLL_MARGIN,
  SHELL_PADDING,
  MIN_SEARCH_HEIGHT,
  DIALOG_MAX_H,
  staggerDelayMs,
} from "../ui";
import {
  ApiError,
  buildFileParam,
  fetchIndexList,
  searchFiles,
  type SearchPerf,
  type SearchResult,
} from "../api";
import { formatFileSize } from "../format";
import { buildHighlighted } from "../../highlight";
import { matchRanges } from "../../match";
import { useEnterOnce, useListTransition } from "../hooks";
import ResultCard from "./ResultCard";
import ErrorNotice from "./ErrorNotice";

const EMPTY_RESULTS: SearchResult[] = [];

function resultKey(item: SearchResult): string {
  return `${item.repository}\u0000${item.branch}\u0000${item.path}\u0000${item.type}`;
}

function titleHtml(item: SearchResult) {
  if (item.highlightedPath && item.highlightedPath !== "undefined") return item.highlightedPath;
  if (item.highlightedName && item.highlightedName !== "undefined") return item.highlightedName;
  // Plain fallback still goes through the shared builder so the name is escaped like everywhere else
  return buildHighlighted(item.name || "", []);
}

const ResultRow = memo(function ResultRow({
  item,
  index,
  leaving,
}: {
  item: SearchResult;
  index: number;
  leaving: boolean;
}) {
  const { t } = useTranslation();
  return (
    <ResultCard
      href={item.github_url || "#"}
      titleHtml={titleHtml(item)}
      subtitle={`${item.repository || ""} / ${item.branch || ""} — ${item.path || ""}`}
      meta={formatFileSize(item)}
      enterDelayMs={staggerDelayMs(index % PAGE_SIZE)}
      leaving={leaving}
      badge={
        <Badge variant={item.type === "file" ? "info" : "primary"}>
          {item.type === "file" ? t("File") : t("Folder")}
        </Badge>
      }
    />
  );
});

/** One selectable index; `html` carries the shared highlight for the current filter query. */
interface IndexOption {
  name: string;
  html?: string;
}

function indexKey(option: IndexOption): string {
  return option.name;
}

function IndexRow({
  name,
  html,
  checked,
  disabled,
  leaving,
  onToggle,
}: {
  name: string;
  html?: string;
  checked: boolean;
  disabled: boolean;
  leaving: boolean;
  onToggle: (on: boolean) => void;
}) {
  const enter = useEnterOnce();
  const animationClass = leaving ? "card-leave" : enter.entering ? "card-enter" : "";
  return (
    <div className={animationClass} onAnimationEnd={enter.onAnimationEnd}>
      <Checkbox
        label={
          html !== undefined ? (
            <span className="text-sm break-all" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <span className="text-sm break-all">{name}</span>
          )
        }
        checked={checked}
        disabled={disabled}
        onCheckedChange={(v) => onToggle(v === true)}
      />
    </div>
  );
}

function LoadingRow({ center = false, children }: { center?: boolean; children: ReactNode }) {
  return (
    <div className={`mt-4 flex items-center gap-2 ${center ? "justify-center" : ""}`}>
      <Loader size="sm" />
      <span className="text-kumo-subtle text-sm">{children}</span>
    </div>
  );
}

export default function Search() {
  const { t } = useTranslation();
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

  // Uncontrolled input: typing only touches the DOM and never triggers a React render; searches fire only on Enter/button/selection change
  const inputRef = useRef<HTMLInputElement>(null);
  // Monotonic request id: stale responses are dropped so results converge on the last submission
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

  // "/" shortcut focuses the search box (not hijacked while already inside an input)
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

  // Infinite scroll: reaching the bottom requests and appends the next page
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
  const [displayResults, leavingResultKeys] = useListTransition(results ?? EMPTY_RESULTS, resultKey);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore || loadingMore || searching) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((en) => en.isIntersecting)) void loadMore();
      },
      { rootMargin: SCROLL_MARGIN },
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
  // Same matcher and highlight builder as the file search and the repo filter
  const filteredIndexes = useMemo<IndexOption[]>(() => {
    const kw = indexFilter.trim();
    if (!kw) return indexes.map((name) => ({ name }));
    const out: IndexOption[] = [];
    for (const name of indexes) {
      const ranges = matchRanges(name, kw);
      if (ranges) out.push({ name, html: buildHighlighted(name, ranges) });
    }
    return out;
  }, [indexes, indexFilter]);
  const [displayIndexes, leavingIndexKeys] = useListTransition(filteredIndexes, indexKey);
  const filteredNames = useMemo(() => filteredIndexes.map((option) => option.name), [filteredIndexes]);

  function selectAll() {
    const next = Array.from(new Set([...checked, ...filteredNames]));
    setChecked(next);
    searchFromInput(next);
  }

  function clearAll() {
    const next = checked.filter((n) => !filteredNames.includes(n));
    setChecked(next);
    searchFromInput(next);
  }

  function invertSelection() {
    const next = [
      ...checked.filter((n) => !filteredNames.includes(n)),
      ...filteredNames.filter((n) => !checked.includes(n)),
    ];
    setChecked(next);
    searchFromInput(next);
  }

  const countLabel = loadingIndexes
    ? t("(loading indexes)")
    : checked.length === 0
      ? t("(none selected)")
      : t("({0} selected)", { 0: checked.length });

  return (
    <section>
      <h1 className={PAGE_TITLE}>{t("Repository file search")}</h1>

      <div className={`flex ${MIN_SEARCH_HEIGHT} items-center gap-4`}>
        <Switch
          size="sm"
          label={t("Search by name")}
          checked={byName}
          disabled={searching}
          onClick={() => {
            const next = !byName;
            setByName(next);
            searchFromInput(checked, next);
          }}
        />
        <span className="text-kumo-subtle text-xs">{t("(path search by default)")}</span>
      </div>

      <div className="mt-2">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <label className="text-kumo-strong font-medium">{t("Search (defaults to all indexes)")}</label>
          <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
            <Dialog.Trigger
              render={(p) => (
                <Button {...p} variant="outline">
                  {t("Select indexes")}
                  <span className="text-kumo-subtle ml-2 grid text-sm tabular-nums">
                    <span className="invisible col-start-1 row-start-1">{t("(loading indexes)")}</span>
                    <span className="invisible col-start-1 row-start-1">
                      {t("({0} selected)", { 0: 9999 })}
                    </span>
                    <span className="col-start-1 row-start-1">{countLabel}</span>
                  </span>
                </Button>
              )}
            />
            <Dialog size="xl" className={SHELL_PADDING}>
              <div className="mb-4 flex items-start justify-between gap-4">
                <Dialog.Title className="text-xl font-semibold">{t("Select indexes")}</Dialog.Title>
                <Dialog.Close
                  aria-label={t("Close")}
                  render={(props) => (
                    <Button
                      {...props}
                      variant="secondary"
                      shape="square"
                      icon={<X />}
                      aria-label={t("Close")}
                    />
                  )}
                />
              </div>
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <Input
                    placeholder={t("Filter indexes…")}
                    value={indexFilter}
                    onChange={(e) => setIndexFilter(e.target.value)}
                  />
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" size="sm" disabled={searching} onClick={selectAll}>
                    {t("Select all")}
                  </Button>
                  <Button variant="secondary" size="sm" disabled={searching} onClick={invertSelection}>
                    {t("Invert selection")}
                  </Button>
                  <Button variant="secondary" size="sm" disabled={searching} onClick={clearAll}>
                    {t("Clear")}
                  </Button>
                </div>
              </div>
              <div className={`bg-kumo-base ${DIALOG_MAX_H} overflow-auto rounded-lg p-2`}>
                {displayIndexes.length === 0 ? (
                  <div className="text-kumo-subtle p-3 text-sm">{t("No matching indexes")}</div>
                ) : (
                  <div className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3">
                    {displayIndexes.map(({ name, html }) => (
                      <IndexRow
                        key={name}
                        name={name}
                        html={html}
                        checked={checked.includes(name)}
                        disabled={searching}
                        leaving={leavingIndexKeys.has(name)}
                        onToggle={(on) => toggleOne(name, on)}
                      />
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-8 flex justify-end gap-2">
                <Dialog.Close
                  render={(props) => (
                    <Button variant="primary" {...props}>
                      {t("Done")}
                    </Button>
                  )}
                />
              </div>
            </Dialog>
          </Dialog.Root>
        </div>
        <div className="flex w-full gap-2">
          <div className="min-w-0 flex-1">
            <Input
              ref={inputRef}
              className="w-full"
              placeholder={t("Type keywords, press Enter or click Search (press / to focus)")}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !searching) searchFromInput();
              }}
            />
          </div>
          <Button
            variant="ghost"
            shape="square"
            aria-label={t("Clear input")}
            title={t("Clear input")}
            icon={<X />}
            onClick={clearInput}
          />
          <Button
            variant="primary"
            loading={searching}
            disabled={searching}
            onClick={() => searchFromInput()}
          >
            {t("Search")}
          </Button>
          <Button
            variant={debug ? "primary" : "ghost"}
            shape="square"
            aria-label={t("Debug mode")}
            aria-pressed={debug}
            title={t("Debug mode: show detailed performance info")}
            icon={<Bug />}
            onClick={toggleDebug}
          />
        </div>
      </div>

      {error && (
        <ErrorNotice
          title={errorStatus ? t("Search failed ({0})", { 0: errorStatus }) : t("Search failed")}
          message={error}
          onRetry={() => searchFromInput()}
          retryDisabled={searching}
        />
      )}
      {searching && <LoadingRow>{t("Searching")}</LoadingRow>}

      <div className="mt-6">
        {results === null && !searching && !error && (
          <Empty
            title={t("Type a keyword to start searching")}
            description={t("Press Enter or click the search button; match by name or path")}
          />
        )}
        {results !== null && displayResults.length === 0 && !searching && (
          <Empty
            title={t("No matches found")}
            description={t("Try another keyword or adjust the index selection")}
          />
        )}
        {displayResults.length > 0 && (
          <div>
            <h2 className="text-kumo-strong mb-2 text-lg font-semibold">
              {t("Results ({0}{1} total · {2} files / {3} folders)", {
                0: total,
                1: perf?.truncated ? "+" : "",
                2: fileCount,
                3: dirCount,
              })}
            </h2>
            {debug && perf && (
              <div className="border-kumo-line bg-kumo-base mb-3 rounded-lg border p-3 font-mono text-xs">
                <div className="text-kumo-subtle">
                  {t("Server {0}ms (fetch {1} / match {2})", {
                    0: perf.tookMs,
                    1: perf.loadMs,
                    2: perf.searchMs,
                  })}
                </div>
                <div className="text-kumo-subtle mt-1">
                  {t("Network round trip {0}ms · returned {1}/{2}", {
                    0: perf.roundTripMs,
                    1: results?.length ?? 0,
                    2: total,
                  })}
                </div>
                <div className="text-kumo-subtle mt-1">
                  {t("Indexes {0} · items {1} · load failures {2}", {
                    0: perf.indexCount,
                    1: perf.itemsTotal,
                    2: perf.loadFailCount,
                  })}
                </div>
              </div>
            )}
            <div className={RESULT_GRID}>
              {displayResults.map((item, i) => (
                <ResultRow
                  key={resultKey(item)}
                  item={item}
                  index={i}
                  leaving={leavingResultKeys.has(resultKey(item))}
                />
              ))}
            </div>
            <div ref={sentinelRef} />
            {loadingMore && (
              <LoadingRow center>
                {t("Loading more (showing {0} / {1} total)", { 0: results?.length ?? 0, 1: total })}
              </LoadingRow>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
