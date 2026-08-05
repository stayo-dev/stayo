/**
 * Universal search — result shapes and the quick actions attached to them.
 *
 * Quick actions are the point of the feature, not decoration: an owner who
 * finds a tenant usually wants to *do* something (ring them, chase a payment),
 * and making them open a profile first turns a two-second job into a
 * four-tap one.
 *
 * Pure — no React, no network — so link building and action availability are
 * testable. Anything that renders is a thin shell over this.
 */

/** Open by design — the server may introduce new types without a client change. */
export type SearchResultType = 'TENANT' | 'HOSTEL' | 'ROOM' | (string & {});

export interface SearchResult {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  meta?: string;
  metaTone?: 'neutral' | 'success' | 'warning' | 'destructive';
  /** Destination decided by the server, so new types route themselves. */
  href: string;
  score: number;
  data?: Record<string, unknown>;
}

export interface SearchGroup {
  type: SearchResultType;
  label: string;
  order: number;
  results: SearchResult[];
}

export interface SearchResponse {
  query: string;
  groups: SearchGroup[];
  total: number;
}

/** Below this the client doesn't even call — matches the server's floor. */
export const MIN_QUERY_LENGTH = 2;

export type QuickActionId = 'call' | 'whatsapp' | 'copy' | 'collect' | 'profile';

export interface QuickAction {
  id: QuickActionId;
  label: string;
  /** `tel:`/`https:` for link actions; absent for in-app actions. */
  href?: string;
}

/** Digits only, so a stored "+91 98765 43210" still dials. */
export function phoneDigits(phone: string | null | undefined): string {
  return (phone ?? '').replace(/\D/g, '');
}

/**
 * `wa.me` needs a country code. Indian mobile numbers are stored inconsistently
 * (10 digits, or 12 with 91), so normalise to the 12-digit form rather than
 * handing WhatsApp a number it will silently fail to open.
 */
export function whatsAppNumber(phone: string | null | undefined): string | null {
  const d = phoneDigits(phone);
  if (d.length === 10) return `91${d}`;
  if (d.length === 12 && d.startsWith('91')) return d;
  // Anything else we can't confidently prefix — better no button than one
  // that opens a chat with the wrong person.
  return null;
}

/**
 * Actions available inline on a result.
 *
 * Only offered when they can actually work: no Call on a tenant with no
 * number, no Collect for someone who owes nothing or hasn't activated yet.
 * A dead button is worse than an absent one.
 */
export function quickActionsFor(result: SearchResult): QuickAction[] {
  if (result.type !== 'TENANT') return [];

  const phone = typeof result.data?.phone === 'string' ? result.data.phone : '';
  const outstanding = Number(result.data?.outstanding ?? 0);
  const invited = Boolean(result.data?.invited);
  const digits = phoneDigits(phone);
  const wa = whatsAppNumber(phone);

  const actions: QuickAction[] = [];

  if (digits) {
    actions.push({ id: 'call', label: 'Call', href: `tel:+${wa ?? digits}` });
  }
  if (wa) {
    actions.push({ id: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/${wa}` });
  }
  if (digits) {
    actions.push({ id: 'copy', label: 'Copy number' });
  }
  // An invited tenant has no dues to collect yet — offering it would send the
  // owner into a flow with nothing in it.
  if (!invited && outstanding > 0) {
    actions.push({ id: 'collect', label: 'Collect' });
  }
  actions.push({ id: 'profile', label: 'Profile' });

  return actions;
}

/** Total results across groups — used for the empty state decision. */
export function countResults(groups: SearchGroup[]): number {
  return groups.reduce((n, g) => n + g.results.length, 0);
}

export type SearchViewState = 'idle' | 'too-short' | 'loading' | 'empty' | 'results';

/**
 * Which state the overlay should render.
 *
 * `loading` deliberately wins over `empty` so a slow response never flashes
 * "No matches" at an owner who is still typing.
 */
export function viewState(input: {
  query: string;
  isLoading: boolean;
  groups: SearchGroup[] | undefined;
}): SearchViewState {
  const q = input.query.trim();
  if (!q) return 'idle';
  if (q.length < MIN_QUERY_LENGTH) return 'too-short';
  if (input.isLoading) return 'loading';
  if (!input.groups || countResults(input.groups) === 0) return 'empty';
  return 'results';
}
