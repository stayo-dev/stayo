import { portfolioService } from "../../portfolio-service";
import { scoreField, sortByScore } from "../ranking";
import type { SearchProvider, SearchResult } from "../types";

/**
 * Hostel search.
 *
 * Reuses `portfolioService.getPortfolioSummary` rather than querying `hostels`
 * directly, so the occupancy and dues shown in a search result are the exact
 * same numbers the Home property cards show. Querying the table here would
 * have meant recomputing occupancy — a second implementation that could drift
 * from the cards by a percentage point and make the owner distrust both.
 *
 * An owner has a handful of hostels, so filtering the already-cached portfolio
 * in memory is cheaper than a round trip.
 */
export const hostelProvider: SearchProvider = {
  type: "HOSTEL",
  label: "Hostels",
  order: 2,

  async search({ ownerId, query, limit }) {
    const q = query.trim();
    if (!q) return [];

    const summary = await portfolioService.getPortfolioSummary(ownerId);

    const results: SearchResult[] = [];
    for (const h of summary.hostels as any[]) {
      const score = Math.max(
        scoreField(q, h.name, "hostel"),
        scoreField(q, h.city, "hostel"),
      );
      if (score <= 0) continue;

      const occupancy = Math.round(Number(h.occupancy_rate ?? 0));
      const dues = Number(h.pending_dues ?? 0);

      results.push({
        type: "HOSTEL",
        id: h.hostel_id,
        title: h.name,
        subtitle: [h.city, `${h.active_tenants}/${h.total_capacity} beds`].filter(Boolean).join(" · "),
        meta: dues > 0 ? `₹${dues.toLocaleString("en-IN")} due` : `${occupancy}% occupied`,
        metaTone: dues > 0 ? "destructive" : occupancy >= 85 ? "success" : "warning",
        href: `/owner/hostels/${h.hostel_id}/overview`,
        score,
        data: { occupancy, dues, vacant: Math.max(0, Number(h.total_capacity ?? 0) - Number(h.active_tenants ?? 0)) },
      });
    }

    return sortByScore(results).slice(0, limit);
  },
};
