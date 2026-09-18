import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge, Empty, Input } from "@cloudflare/kumo";
import { fetchRepos, type RepoInfo } from "../api";
import { formatRepoSize } from "../format";
import { buildHighlighted } from "../../highlight";
import { matchRanges } from "../../match";
import { useListTransition } from "../hooks";
import ResultCard, { CardSkeleton } from "./ResultCard";
import ErrorNotice from "./ErrorNotice";
import { PAGE_TITLE, RESULT_GRID, SKELETON_COUNT, staggerDelayMs } from "../ui";

/** A repo plus the shared highlight HTML for each searched field (undefined = no filter query). */
interface FilteredRepo {
  repo: RepoInfo;
  titleHtml?: string;
  subtitleHtml?: string;
}

function repoKey(item: FilteredRepo): string {
  return item.repo.html_url;
}

export default function RepoList() {
  const { t } = useTranslation();
  const [repos, setRepos] = useState<RepoInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  // Same matcher as the file search: full name and description, both highlighted where they match
  const filteredRepos = useMemo<FilteredRepo[]>(() => {
    const kw = filter.trim();
    if (!kw) return repos.map((repo) => ({ repo }));
    const out: FilteredRepo[] = [];
    for (const repo of repos) {
      const titleRanges = matchRanges(repo.full_name, kw);
      const description = repo.description ?? "";
      const subtitleRanges = matchRanges(description, kw);
      if (!titleRanges && !subtitleRanges) continue;
      out.push({
        repo,
        titleHtml: titleRanges ? buildHighlighted(repo.full_name, titleRanges) : undefined,
        subtitleHtml: subtitleRanges ? buildHighlighted(description, subtitleRanges) : undefined,
      });
    }
    return out;
  }, [repos, filter]);

  const [displayRepos, leavingKeys] = useListTransition(filteredRepos, repoKey);

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

      {!error && !loading && repos.length > 0 && displayRepos.length === 0 && (
        <div className="text-kumo-subtle mt-6 text-sm">{t("No matching repositories")}</div>
      )}

      <div className={`mt-6 ${RESULT_GRID}`}>
        {displayRepos.map(({ repo, titleHtml, subtitleHtml }, i) => (
          <ResultCard
            key={repo.html_url}
            href={repo.html_url}
            title={repo.full_name}
            titleHtml={titleHtml}
            subtitle={repo.description || ""}
            subtitleHtml={subtitleHtml}
            meta={formatRepoSize(repo)}
            badge={riskBadge(repo.risk)}
            enterDelayMs={staggerDelayMs(i)}
            leaving={leavingKeys.has(repo.html_url)}
          />
        ))}
      </div>
    </section>
  );
}
