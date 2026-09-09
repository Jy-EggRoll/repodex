import { useEffect, useRef, useState } from 'react';
import { Button, Input, Switch, Checkbox, Badge, Dialog, Banner, Loader, Empty } from '@cloudflare/kumo';
import { X } from '@phosphor-icons/react';
import { fetchIndexList, searchFiles, type SearchResult } from '../api';

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

export default function Search() {
  const [query, setQuery] = useState('');
  const [byName, setByName] = useState(false);
  const [indexes, setIndexes] = useState<string[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const [loadingIndexes, setLoadingIndexes] = useState(false);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const timer = useRef<number>(0);

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

  useEffect(() => {
    loadIndexes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doSearch(q = query, list = checked) {
    const v = q.trim();
    if (!v) return;
    setError('');
    setSearching(true);
    try {
      const fileParam = list.length > 0 && list.length !== indexes.length ? list.join(',') : 'all';
      const data = await searchFiles(v, fileParam, byName ? 'name' : 'path');
      setResults(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  function scheduleSearch(q = query, list = checked, ms = 300) {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => doSearch(q, list), ms);
  }

  function toggleOne(name: string, on: boolean) {
    const next = on ? [...checked, name] : checked.filter((v) => v !== name);
    setChecked(next);
    scheduleSearch(query, next, 150);
  }

  function toggleAll(on: boolean) {
    const next = on ? indexes : [];
    setChecked(next);
    scheduleSearch(query, next, 150);
  }

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
            scheduleSearch(query, checked, 150);
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
                placeholder="输入关键字，结果将动态展示"
                value={query}
                onChange={(e) => {
                  const v = e.target.value;
                  setQuery(v);
                  if (v.trim()) scheduleSearch(v, checked, 300);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') doSearch();
                }}
              />
            </div>
            <Button variant="primary" loading={searching} disabled={searching} onClick={() => doSearch()}>
              搜索
            </Button>
          </div>
          <Dialog.Root open={dialogOpen} onOpenChange={setDialogOpen}>
            <Dialog.Trigger render={(p) => <Button {...p} variant="outline">选择索引 <span className="ml-2 text-sm text-kumo-subtle">{countLabel}</span></Button>} />
            <Dialog size="lg" className="p-8">
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

      {error && <div className="mt-4"><Banner variant="error" title="搜索失败" description={error} /></div>}
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
        {results !== null && results.length > 0 && (
          <div>
            <h2 className="mb-2 text-lg font-semibold text-kumo-strong">匹配结果（{results.length}）</h2>
            <div className="space-y-3">
              {results.map((item, i) => (
                <a
                  key={`${item.repository}-${item.branch}-${item.path}-${item.type}-${i}`}
                  href={item.github_url || '#'}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full rounded-lg bg-kumo-base p-3 transition-colors hover:shadow-sm"
                >
                  <div className="flex w-full items-start justify-between gap-4">
                    <div className="flex-1 text-left">
                      <div
                        className="break-all text-lg font-semibold leading-tight text-kumo-strong"
                        dangerouslySetInnerHTML={{ __html: titleHtml(item) }}
                      />
                      <div className="mt-1 break-all break-words whitespace-pre-wrap text-xs text-kumo-subtle">
                        {item.repository || ''} / {item.branch || ''} — {item.path || ''}
                      </div>
                    </div>
                    <div className="flex flex-col items-end justify-start">
                      <div className="text-sm text-kumo-subtle">{sizeText(item)}</div>
                      <div className="mt-2">
                        <Badge variant={item.type === 'file' ? 'info' : 'primary'}>
                          {item.type === 'file' ? '文件' : '文件夹'}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
