import { DurableObject } from "cloudflare:workers";
import { errorOutcome, runRepoList, runSearch, type Outcome, type SearchSpec } from "./search-core";

interface Env {
  repo_index_kv: KVNamespace;
}

/**
 * Single search engine instance (idFromName("global")): the whole corpus scan runs here, under the
 * Durable Object CPU budget, because a plain Worker request (10ms on the free plan) cannot afford it.
 * Returns response bodies already serialized so the caller can relay them without re-parsing.
 */
export class SearchEngine extends DurableObject<Env> {
  async search(spec: SearchSpec): Promise<Outcome> {
    if (!this.env.repo_index_kv) return errorOutcome(500, "repo_index_kv binding is not available");
    return runSearch((key) => this.env.repo_index_kv.get(key), spec);
  }

  async listIndexes(): Promise<Outcome> {
    if (!this.env.repo_index_kv) return errorOutcome(500, "repo_index_kv binding is not available");
    return runRepoList((key) => this.env.repo_index_kv.get(key));
  }
}
