import { useEffect, useState } from "react";
import { Badge, Empty } from "@cloudflare/kumo";
import { fetchRepos, type RepoInfo } from "../api";
import { formatRepoSize } from "../format";
import ResultCard, { CardSkeleton } from "./ResultCard";
import ErrorNotice from "./ErrorNotice";
import { PAGE_TITLE, RESULT_GRID, SKELETON_COUNT, staggerDelayMs } from "../ui";

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

  // 首屏自动加载（中央索引每小时预写快照）
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section>
      <h1 className={PAGE_TITLE}>GitHub 仓库列表</h1>

      {error && <ErrorNotice title="加载失败" message={error} />}
      {!error && !loading && repos.length === 0 && (
        <div className="mt-6">
          <Empty title="暂无仓库数据" description="数据获取中" />
        </div>
      )}
      {loading && repos.length === 0 && (
        <div className={`mt-6 ${RESULT_GRID}`}>
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}

      <div className={`mt-6 ${RESULT_GRID}`}>
        {repos.map((repo, i) => (
          <ResultCard
            key={repo.html_url}
            href={repo.html_url}
            title={repo.name}
            subtitle={repo.description || ""}
            meta={formatRepoSize(repo)}
            badge={riskBadge(repo.risk)}
            enterDelayMs={staggerDelayMs(i)}
          />
        ))}
      </div>
    </section>
  );
}
