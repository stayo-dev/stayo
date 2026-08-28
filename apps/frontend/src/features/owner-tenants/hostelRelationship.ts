import type { DisclosedHistory } from './api/tenantHistory';
import type { ResidencyStay } from '@features/profile/api';

export type HostelRelationship = 'NEW' | 'CURRENT_TENANT' | 'PREVIOUS_TENANT' | 'ACTIVE_ELSEWHERE' | 'UNKNOWN';

export interface HostelRelationshipResult {
  relationship: HostelRelationship;
  /** Most relevant stay at this hostel: the current one if live, else the
   *  most recent past one (relies on getOwnHistory's created_at-desc
   *  ordering, already applied server-side). Null for NEW/UNKNOWN. */
  stay: ResidencyStay | null;
}

/**
 * Whether the person behind an enquiry has ever stayed at THIS hostel —
 * derived entirely from data `getDisclosedHistory`/`resolveAccess` already
 * decided to disclose. Never queries anything itself: if access hasn't been
 * earned, this returns UNKNOWN rather than guessing NEW, because collapsing
 * "we don't know" into "new" would misrepresent an unknown state as a fact
 * and could leak whether history exists. See docs/obsidian/Decisions.md
 * ADR-075 for the disclosure rule this composes with rather than duplicates.
 *
 * Deliberately does not distinguish "never enquired" from "enquired but
 * never moved in" — both read as NEW, since `toStay()` already excludes any
 * tenancy that never produced `ever_moved_in`/`is_current`.
 */
export function classifyHostelRelationship(history: DisclosedHistory, hostelId: string): HostelRelationshipResult {
  if (!history.allowed) {
    return { relationship: 'UNKNOWN', stay: null };
  }

  const staysHere = history.stays.filter((stay) => stay.hostel.id === hostelId);
  if (staysHere.length === 0) {
    // Not a stay at THIS hostel — but they may currently be live at a
    // DIFFERENT one, which is what actually blocks an invite here (not
    // "NEW"). `stays` already spans every hostel the person has been at once
    // access is earned (see the file header) — this reads what's already
    // disclosed, it does not request anything new.
    const elsewhere = history.stays.find((stay) => stay.is_current);
    if (elsewhere) {
      return { relationship: 'ACTIVE_ELSEWHERE', stay: elsewhere };
    }
    return { relationship: 'NEW', stay: null };
  }

  const current = staysHere.find((stay) => stay.is_current);
  if (current) {
    return { relationship: 'CURRENT_TENANT', stay: current };
  }

  return { relationship: 'PREVIOUS_TENANT', stay: staysHere[0] };
}
