import { useEffect, useState } from "react";
import { Button, Badge, Banner, Loader, Empty } from "@cloudflare/kumo";
import { fetchRepos, type RepoInfo } from "../api";
import { formatRepoSize } from "../format";
import ResultCard, { CardSkeleton } from "./ResultCard";

function riskBadge(risk: RepoInfo["risk"]) {
  if (risk === "danger") return <Badge variant="error">危险</Badge>;
  if (risk === "warn") return <Badge variant="warning">警告</Badge>;
  return <Badge variant="success">安全</Badge>;
}

export default function RepoList() {
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    setLoading(true);
    setError("");
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

  // 首屏自动加载（服务端 5 分钟缓存，成本可忽略），按钮保留作刷新
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section>
      <h1 className="text-kumo-strong mb-4 text-2xl font-bold">GitHub 仓库列表</h1>
      <div className="flex min-h-[56px] flex-col items-start gap-3 sm:flex-row sm:items-center">
        <div className="flex w-full items-center gap-3 sm:w-auto">
          <Button variant="primary" loading={loading} disabled={loading} onClick={load}>
            刷新仓库数据
          </Button>
          {loading && (
            <span className="flex items-center gap-2">
              <Loader size="sm" />
              <span className="text-kumo-subtle text-sm">加载中</span>
            </span>
          )}
        </div>
      </div>

      {error && (
        <div className="mt-2 w-full">
          <Banner variant="error" title="加载失败" description={error} />
        </div>
      )}
      {!error && !loading && repos.length === 0 && (
        <div className="mt-6">
          <Empty title="暂无仓库数据" description="点击刷新重试" />
        </div>
      )}
      {loading && repos.length === 0 && (
        <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
        {repos.map((repo) => (
          <ResultCard
            key={repo.html_url}
            href={repo.html_url}
            title={repo.name}
            subtitle={repo.description || ""}
            meta={formatRepoSize(repo)}
            badge={riskBadge(repo.risk)}
          />
        ))}
      </div>
    </section>
  );
}
