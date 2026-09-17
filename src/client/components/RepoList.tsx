import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Empty, Input } from "@cloudflare/kumo";
import { fetchRepos, type RepoInfo } from "../api";
import { formatRepoSize } from "../format";
import ResultCard, { CardSkeleton } from "./ResultCard";
import ErrorNotice from "./ErrorNotice";
import { PAGE_TITLE, RESULT_GRID, SKELETON_COUNT, staggerDelayMs } from "../ui";

export default function RepoList() {
  const { t } = useTranslation();
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  const filteredRepos = useMemo(() => {
    const kw = filter.trim().toLowerCase();
    if (!kw) return repos;
    return repos.filter(
      (r) => r.name.toLowerCase().includes(kw) || (r.description ?? "").toLowerCase().includes(kw),
    );
  }, [repos, filter]);

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

  // Load on first mount (the central index pre-writes the snapshot hourly)
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function riskBadge(risk: RepoInfo["risk"]) {
    if (risk === "danger") return <Badge variant="error">{t("Danger")}</Badge>;
    if (risk === "warn") return <Badge variant="warning">{t("Warning")}</Badge>;
    return <Badge variant="success">{t("Safe")}</Badge>;
  }

  return (
    <section>
      <h1 className={PAGE_TITLE}>{t("GitHub repositories")}</h1>

      <div className="mb-4">
        <Input
          aria-label={t("Filter repositories")}
          placeholder={t("Filter repositories (name or description)…")}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="w-full"
        />
      </div>

      {error && <ErrorNotice title={t("Load failed")} message={error} />}
      {!error && !loading && repos.length === 0 && (
        <div className="mt-6">
          <Empty title={t("No repository data")} description={t("Fetching data")} />
        </div>
      )}
      {loading && repos.length === 0 && (
        <div className={`mt-6 ${RESULT_GRID}`}>
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}

      {!error && !loading && repos.length > 0 && filteredRepos.length === 0 && (
        <div className="text-kumo-subtle mt-6 text-sm">{t("No matching repositories")}</div>
      )}

      <div className={`mt-6 ${RESULT_GRID}`}>
        {filteredRepos.map((repo, i) => (
          <ResultCard
            key={repo.html_url}
            href={repo.html_url}
            title={repo.full_name}
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
