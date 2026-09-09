import { memo, startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Input, Switch, Checkbox, Badge, Dialog, Banner, Loader, Empty } from '@cloudflare/kumo';
import { X } from '@phosphor-icons/react';
import { ApiError, fetchIndexList, searchFiles, type SearchResult } from '../api';
import ResultCard from './ResultCard';

const PAGE_SIZE = 100;

function sizeText(item: SearchResult) {
  if (typeof item.size === 'number' && !Number.isNaN(item.size)) {
    return `${Math.round((item.size / 1024 / 1024) * 100) / 100} MB`;
  }
  if (typeof item.size_mb === 'number' && !Number.isNaN(item.size_mb)) {
    return `${item.size_mb} MB`;
  }
  return '-';
}

function titleHtml(item: SearchResult) {
  if (item.highlightedPath && item.highlightedPath !== 'undefined') return item.highlightedPath;
  if (item.highlightedName && item.highlightedName !== 'undefined') return item.highlightedName;
  return item.name || '';
}

const ResultRow = memo(function ResultRow({ item }: { item: SearchResult }) {
  return (
    <ResultCard
      href={item.github_url || '#'}
      titleHtml={titleHtml(item)}
      subtitle={`${item.repository || ''} / ${item.branch || ''} — ${item.path || ''}`}
      meta={sizeText(item)}
      badge={
        <Badge variant={item.type === 'file' ? 'info' : 'primary'}>
          {item.type === 'file' ? '文件' : '文件夹'}
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
  const [error, setError] = useState('');
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [total, setTotal] = useState(0);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [dialogOpen, setDialogOpen] = useState(false);

  // 输入框非受控：敲字只走 DOM，不触发 React 渲染；搜索只由按钮/回车/切换手动触发
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

  async function doSearch(q: string, list: string[], nameMode: boolean) {
    const v = q.trim();
    if (!v) return;
    const id = ++requestIdRef.current;
    setError('');
    setErrorStatus(null);
    setSearching(true);
    try {
      const fileParam = list.length > 0 && list.length !== indexes.length ? list.join(',') : 'all';
      const data = await searchFiles(v, fileParam, nameMode ? 'name' : 'path');
      if (id !== requestIdRef.current) return;
      setVisibleCount(PAGE_SIZE);
      setTotal(data.total);
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
    void doSearch(inputRef.current?.value ?? '', list, nameMode);
  }

  function toggleOne(name: string, on: boolean) {
    const next = on ? [...checked, name] : checked.filter((v) => v !== name);
    setChecked(next);
    searchFromInput(next);
  }

  function toggleAll(on: boolean) {
    const next = on ? indexes : [];
    setChecked(next);
    searchFromInput(next);
  }

  const visibleResults = useMemo(
    () => results?.slice(0, visibleCount) ?? null,
    [results, visibleCount],
  );

  const allChecked = indexes.length > 0 && checked.length === indexes.length;
  const countLabel = loadingIndexes
    ? '（请求索引中）'
    : checked.length === 0
      ? '（未选择）'
      : `（${checked.length} 已选）`;

  return (
    <section>
      <h1 className="mb-4 text-2xl font-bold text-kumo-strong">仓库文件搜索</h1>

      <div className="flex min-h-[56px] items-center gap-4">
        <Switch
          size="sm"
          label="按名称搜索"
          checked={byName}
          onClick={() => {
            const next = !byName;
            setByName(next);
            searchFromInput(checked, next);
          }}
        />
        <span className="text-xs text-kumo-subtle">（默认按路径搜索）</span>
      </div>

      <div className="mt-2">
        <label className="mb-2 block font-medium text-kumo-strong">搜索（默认在所有索引中搜索）</label>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <div className="flex w-full flex-1 gap-2">
            <div className="min-w-0 flex-1">
              <Input
                ref={inputRef}
                placeholder="输入关键字，回车或点击搜索"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') searchFromInput();
                }}
              />
            </div>
            <Button variant="primary" loading={searching} onClick={() => searchFromInput()}>
              搜索
            </Button>
          </div>
          <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
            <Dialog.Trigger render={(p) => <Button {...p} variant="outline">选择索引 <span className="ml-2 text-sm text-kumo-subtle">{countLabel}</span></Button>} />
            <Dialog size="lg" className="p-4 sm:p-6">
              <div className="mb-4 flex items-start justify-between gap-4">
                <Dialog.Title className="text-xl font-semibold">选择索引</Dialog.Title>
                <Dialog.Close
                  aria-label="Close"
                  render={(props) => <Button {...props} variant="secondary" shape="square" icon={<X />} aria-label="Close" />}
                />
              </div>
              <div className="max-h-64 overflow-auto rounded-lg bg-kumo-base p-2">
                <div className="mb-2">
                  <Checkbox label="全部索引" checked={allChecked} onCheckedChange={(v) => toggleAll(v === true)} />
                </div>
                {indexes.map((fname) => (
                  <div key={fname} className="mb-1">
                    <Checkbox
                      label={<span className="break-all text-sm">{fname}</span>}
                      checked={checked.includes(fname)}
                      onCheckedChange={(v) => toggleOne(fname, v === true)}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-8 flex justify-end gap-2">
                <Dialog.Close render={(props) => <Button variant="primary" {...props}>完成</Button>} />
              </div>
            </Dialog>
          </Dialog.Root>
        </div>
      </div>

      {error && (
        <div className="mt-4">
          <Banner
            variant="error"
            title="搜索失败"
            description={
              errorStatus === 503
                ? '服务端计算超时，请缩短关键词、只选单个索引后重试。'
                : error
            }
          />
          <div className="mt-2">
            <Button variant="secondary" size="sm" onClick={() => searchFromInput()}>
              重试
            </Button>
          </div>
        </div>
      )}
      {searching && (
        <div className="mt-4 flex items-center gap-2">
          <Loader size="sm" />
          <span className="text-sm text-kumo-subtle">搜索中</span>
        </div>
      )}

      <div className="mt-6">
        {results !== null && results.length === 0 && !searching && (
          <Empty title="未找到匹配" description="换个关键字或调整索引选择试试" />
        )}
        {visibleResults !== null && visibleResults.length > 0 && results !== null && (
          <div>
            <h2 className="mb-2 text-lg font-semibold text-kumo-strong">匹配结果（共 {total} 条）</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {visibleResults.map((item, i) => (
                <ResultRow
                  key={`${item.repository}-${item.branch}-${item.path}-${item.type}-${i}`}
                  item={item}
                />
              ))}
            </div>
            {visibleCount < results.length && (
              <div className="mt-4 flex justify-center">
                <Button variant="secondary" onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}>
                  加载更多（已显示 {visibleResults.length} / 共 {results.length}）
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
