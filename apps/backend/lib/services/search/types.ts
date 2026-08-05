/**
 * Universal search — provider contract.
 *
 * Phase 1 ships tenants, hostels and rooms. Payments, complaints, expenses,
 * receipts and staff are planned. **Nothing in the route or the frontend may
 * branch on a specific result type** — adding a source must mean writing one
 * provider and registering it, nothing else.
 *
 * That is why `data` is an open bag and routing is expressed as `href` here on
 * the server: the client renders whatever groups it is given, in the order it
 * is given, and navigates wherever each result says. A new provider therefore
 * needs no client change at all.
 */

/** Extensible by design — do not narrow this to a closed union in consumers. */
export type SearchResultType = 'TENANT' | 'HOSTEL' | 'ROOM';

export interface SearchResult {
  type: SearchResultType;
  /** Domain id (tenant id, hostel id, room id). */
  id: string;
  /** Primary line, e.g. "Rahul Sharma". */
  title: string;
  /** Secondary line, e.g. "Room 203 · MG Road". */
  subtitle: string;
  /**
   * Trailing business signal, e.g. "₹8,000 overdue" or "92% occupied".
   * Owner language only — never a status enum or flag.
   */
  meta?: string;
  /** Tone for the meta chip; the client maps this to colour. */
  metaTone?: 'neutral' | 'success' | 'warning' | 'destructive';
  /** Where tapping the result goes. Owned by the provider, not the client. */
  href: string;
  /** Ranking score from `ranking.ts`. */
  score: number;
  /**
   * Payload for inline quick actions (call, WhatsApp, collect…). Open on
   * purpose — a future provider can carry whatever its actions need.
   */
  data?: Record<string, unknown>;
}

export interface SearchGroup {
  type: SearchResultType;
  /** Owner-facing plural heading, e.g. "Tenants". */
  label: string;
  /** Group display order, ascending. */
  order: number;
  results: SearchResult[];
}

export interface SearchContext {
  ownerId: string;
  query: string;
  /** Per-provider cap. The route decides the overall budget. */
  limit: number;
}

export interface SearchProvider {
  type: SearchResultType;
  label: string;
  order: number;
  /**
   * Must be owner-scoped. Must never throw for a bad query — return [] so one
   * failing source cannot blank the whole search.
   */
  search(ctx: SearchContext): Promise<SearchResult[]>;
}
