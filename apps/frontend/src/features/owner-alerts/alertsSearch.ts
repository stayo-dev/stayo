import { toLocalPhone } from '@shared/lib/phone';
import { LEAD_SOURCE_LABEL, leadStatusLabel } from './leadConstants';
import type {
  DynamicAdminMessage,
  DynamicAlertCategory,
  DynamicLead,
  DynamicRenewal,
  DynamicRequest,
} from './hooks/useAlerts';

/**
 * Searching the Alerts tab.
 *
 * Four lists live behind four chips — Leads, Messages, Renewals, Requests —
 * and an owner looking for one person has no idea which of them they are
 * filed under. A plain filter on the open tab is the wrong tool for that: type
 * "Riya" while standing on Leads, get "no results", and conclude Riya is not
 * in Stayo at all when she is sitting in Renewals one chip away.
 *
 * So this searches **all four**, shows the matches for the chip you are on,
 * and reports what the same query found in the others so the page can offer
 * them. Nothing is hidden by which tab happened to be open.
 *
 * Matching, in order of what actually gets typed:
 *
 * - **Every word must match, anywhere in the record.** "riya sri" finds Riya
 *   at Sri Adithya; word order and field boundaries do not matter, because an
 *   owner does not know which field holds what.
 * - **Digits match the phone**, on its last 10 (`toLocalPhone`) — so `8046`
 *   finds `+918008046952`, and the country code never has to be typed. Same
 *   national-tail rule the server-side owner search uses (ADR-044).
 * - **Labels are searched, not just raw values.** A lead's status reads
 *   "Ready to join" on screen, so that is what someone types — never
 *   `READY_TO_JOIN`.
 *
 * PURE MODULE — `apps/frontend` tests run without a DOM, and search that
 * quietly stops matching is the kind of thing nobody notices until an owner
 * says "she isn't in here".
 */

/** Below this, a query is treated as not yet a query — matches ADR-044's server-side rule. */
export const MIN_ALERTS_QUERY_LENGTH = 2;

export interface AlertsLists {
  leads: DynamicLead[];
  adminMessages: DynamicAdminMessage[];
  renewals: DynamicRenewal[];
  requests: DynamicRequest[];
}

export interface AlertsSearchResult extends AlertsLists {
  /** False when the box is empty or too short — every list passes through whole. */
  active: boolean;
  counts: Record<DynamicAlertCategory, number>;
  total: number;
}

/**
 * What a record can be searched by: prose in `text`, phone numbers in
 * `phones`.
 *
 * They are kept apart because a phone must be matched **numerically, never as
 * loose text**. With the number in the text haystack, typing `80` matched
 * `+918008046952` as a plain substring — and `80` matches roughly every Indian
 * mobile in the account, which is worse than no result.
 */
export interface Haystack {
  text: string[];
  phones: string[];
}

function leadHaystack(lead: DynamicLead): Haystack {
  return {
    text: [
      lead.student_name,
      lead.hostel?.name ?? '',
      LEAD_SOURCE_LABEL[lead.source] ?? lead.source,
      leadStatusLabel(lead.status),
    ],
    phones: [lead.student_phone ?? ''],
  };
}

const messageHaystack = (m: DynamicAdminMessage): Haystack => ({ text: [m.title, m.body], phones: [] });
const renewalHaystack = (r: DynamicRenewal): Haystack => ({ text: [r.name, r.detail], phones: [] });
const requestHaystack = (q: DynamicRequest): Haystack => ({ text: [q.name, q.detail, q.type], phones: [] });

export function normaliseQuery(query: string): string[] {
  return String(query ?? '')
    .toLowerCase()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

/**
 * Whether one record matches. Exported because the rule is the thing worth
 * testing, and it is the same rule for all four lists.
 */
export function matchesTokens(haystack: Haystack, tokens: string[]): boolean {
  if (tokens.length === 0) return true;
  // Joined with a separator no token can span, so "riya sri" cannot match by
  // accident across the end of one field and the start of the next.
  const text = haystack.text.join(' | ').toLowerCase();
  const tails = haystack.phones
    .map((phone) => toLocalPhone(phone))
    .filter((tail) => tail.length > 0);

  return tokens.every((rawToken) => {
    // Lowercased here as well as in `normaliseQuery`, so the rule holds for
    // any caller rather than only the one that happens to pre-normalise.
    const token = String(rawToken).toLowerCase();
    const digits = token.replace(/\D/g, '');

    // An all-digit token is someone typing part of a phone number. It is
    // matched only against the number — never as a substring of prose, and
    // never below three digits.
    //
    // The typed value goes through `toLocalPhone` as well as the stored one,
    // so pasting a full `918008046952` still matches: both sides reduce to
    // the same national tail, whichever notation each happens to be in.
    if (digits.length > 0 && digits === token) {
      if (digits.length < 3) return false;
      const typed = toLocalPhone(digits);
      return tails.some((tail) => tail.includes(typed));
    }

    return text.includes(token);
  });
}

export function searchAlerts(query: string, lists: AlertsLists): AlertsSearchResult {
  const tokens = normaliseQuery(query);
  const active = query.trim().length >= MIN_ALERTS_QUERY_LENGTH && tokens.length > 0;

  const leads = active ? lists.leads.filter((l) => matchesTokens(leadHaystack(l), tokens)) : lists.leads;
  const adminMessages = active
    ? lists.adminMessages.filter((m) => matchesTokens(messageHaystack(m), tokens))
    : lists.adminMessages;
  const renewals = active
    ? lists.renewals.filter((r) => matchesTokens(renewalHaystack(r), tokens))
    : lists.renewals;
  const requests = active
    ? lists.requests.filter((q) => matchesTokens(requestHaystack(q), tokens))
    : lists.requests;

  const counts = {
    leads: leads.length,
    admin: adminMessages.length,
    renewals: renewals.length,
    requests: requests.length,
  };

  return {
    active,
    leads,
    adminMessages,
    renewals,
    requests,
    counts,
    total: counts.leads + counts.admin + counts.renewals + counts.requests,
  };
}

/**
 * The categories a search hit that the owner is not currently looking at.
 *
 * This is the whole point of searching all four: standing on an empty Leads
 * tab, "2 in Renewals" is the difference between finding someone and deciding
 * they are not in Stayo.
 */
export function matchesElsewhere(
  result: AlertsSearchResult,
  current: DynamicAlertCategory,
): Array<{ category: DynamicAlertCategory; count: number }> {
  if (!result.active) return [];
  return (['leads', 'admin', 'renewals', 'requests'] as DynamicAlertCategory[])
    .filter((category) => category !== current && result.counts[category] > 0)
    .map((category) => ({ category, count: result.counts[category] }));
}
