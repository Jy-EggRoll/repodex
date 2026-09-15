import { DurableObject } from "cloudflare:workers";
import { errorOutcome, runSearch, type Outcome, type KvReader, type SearchSpec } from "./search-core";

interface Env {
  repo_index_kv: KVNamespace;
}

/**
 * Single search engine instance (idFromName("global")): the whole corpus scan runs here, under the
 * Durable Object CPU budget, because a plain Worker request (10ms on the free plan) cannot afford it.
 * Returns the response body already serialized so the caller can relay it without re-parsing.
 */
export class SearchEngine extends DurableObject<Env> {
  async search(spec: SearchSpec): Promise<Outcome> {
    if (!this.env.repo_index_kv) return errorOutcome(500, "repo_index_kv binding is not available");
    return runSearch(createKvReader(this.env.repo_index_kv), spec);
  }
}

function createKvReader(kv: KVNamespace): KvReader {
  return {
    get: (key) => kv.get(key),
    list: async () => {
      const names: string[] = [];
      let cursor: string | undefined;
      // Paginate: chunk keys must not push -index names out of the first page (the old single 1000-key
      // list would silently miss repos once the corpus outgrows one page)
      for (let page = 0; page < 10; page++) {
        const res = await kv.list({ limit: 1000, cursor });
        for (const k of res.keys) names.push(k.name);
        if (res.list_complete) break;
        cursor = res.cursor;
      }
      return names;
    },
  };
}
