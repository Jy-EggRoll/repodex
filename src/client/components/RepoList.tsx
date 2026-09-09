import { useState } from 'react';
import { Button, Badge, Banner, Loader, Empty } from '@cloudflare/kumo';
import { fetchRepos, type RepoInfo } from '../api';

function riskBadge(risk: RepoInfo['risk']) {
  if (risk === 'danger') return <Badge variant="error">危险</Badge>;
  if (risk === 'warn') return <Badge variant="warning">警告</Badge>;
  return <Badge variant="success">安全</Badge>;
}

export default function RepoList() {
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const data = await fetchRepos();
      data.sort((a, b) => (b.size_mb || 0) - (a.size_mb || 0));
      setRepos(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section>
      <h1 className="mb-4 text-2xl font-bold text-kumo-strong">GitHub 仓库列表</h1>
      <div className="flex min-h-[56px] flex-col items-start gap-3 sm:flex-row sm:items-center">
        <div className="flex w-full items-center gap-3 sm:w-auto">
          <Button variant="primary" loading={loading} disabled={loading} onClick={load}>
            点击加载仓库数据
          </Button>
          {loading && (
            <span className="flex items-center gap-2">
              <Loader size="sm" />
              <span className="text-sm text-kumo-subtle">加载中</span>
            </span>
          )}
        </div>
      </div>

      {error && <div className="mt-2 w-full"><Banner variant="error" title="加载失败" description={error} /></div>}
      {!error && !loading && repos.length === 0 && (
        <div className="mt-6"><Empty title="暂无仓库数据" description="点击上方按钮加载" /></div>
      )}

      <div className="mt-6 space-y-3">
        {repos.map((repo) => {
          const sizeText =
            typeof repo.size_mb === 'number' && !Number.isNaN(repo.size_mb)
              ? `${repo.size_mb} MB`
              : `${((repo.size || 0) / 1024).toFixed(2)} MB`;
          return (
            <a
              key={repo.html_url}
              href={repo.html_url}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-full rounded-lg bg-kumo-base p-3 transition-colors hover:shadow-sm"
            >
              <div className="flex w-full items-start justify-between gap-4">
                <div className="flex-1 text-left">
                  <div className="break-all text-lg font-semibold leading-tight text-kumo-strong">{repo.name}</div>
                  <div className="mt-1 break-all break-words whitespace-pre-wrap text-xs text-kumo-subtle">
                    {repo.description || ''}
                  </div>
                </div>
                <div className="flex flex-col items-end justify-start">
                  <div className="text-sm text-kumo-subtle">{sizeText}</div>
                  <div className="mt-2">{riskBadge(repo.risk)}</div>
                </div>
              </div>
            </a>
          );
        })}
      </div>
    </section>
  );
}
