import { tenantProvider } from "./providers/tenant-provider";
import { hostelProvider } from "./providers/hostel-provider";
import { roomProvider } from "./providers/room-provider";
import type { SearchGroup, SearchProvider } from "./types";

/**
 * Universal search registry.
 *
 * **To add a source (payments, complaints, expenses, receipts, staff): write a
 * provider and add it to this array. Nothing else changes** — not the route,
 * not the response shape, not the client. That constraint is the point of the
 * feature; the moment something outside a provider branches on a result type,
 * the extensibility is gone.
 */
export const SEARCH_PROVIDERS: SearchProvider[] = [tenantProvider, hostelProvider, roomProvider];

/** Below this, a typeahead matches almost everything and is just noise. */
export const MIN_QUERY_LENGTH = 2;

export class SearchService {
  constructor(private readonly providers: SearchProvider[] = SEARCH_PROVIDERS) {}

  async search(params: { ownerId: string; query: string; limitPerGroup?: number }): Promise<{
    query: string;
    groups: SearchGroup[];
    total: number;
  }> {
    const query = (params.query ?? "").trim();
    const limit = params.limitPerGroup ?? 8;

    if (query.length < MIN_QUERY_LENGTH) {
      return { query, groups: [], total: 0 };
    }

    // Providers run in parallel and are individually fault-isolated: one
    // source failing must degrade its own group, never blank the whole search
    // while the owner is mid-keystroke.
    const settled = await Promise.allSettled(
      this.providers.map((p) => p.search({ ownerId: params.ownerId, query, limit })),
    );

    const groups: SearchGroup[] = [];
    settled.forEach((outcome, i) => {
      const provider = this.providers[i];
      if (outcome.status === "rejected") {
        console.error(`[search] provider ${provider.type} failed`, outcome.reason);
        return;
      }
      if (outcome.value.length === 0) return;
      groups.push({
        type: provider.type,
        label: provider.label,
        order: provider.order,
        results: outcome.value,
      });
    });

    groups.sort((a, b) => a.order - b.order);

    return { query, groups, total: groups.reduce((n, g) => n + g.results.length, 0) };
  }
}

export const searchService = new SearchService();
