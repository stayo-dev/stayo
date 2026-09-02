/**
 * The gaps worth interrupting an owner about, for one hostel.
 *
 * These lines used to render on the owner's **Profile**, derived from
 * `session.primaryHostelId`. That was wrong in a way that got worse the more
 * hostels an owner had: the warning named a gap in a hostel it could not
 * identify, and its link went to a per-hostel screen with no hostel id
 * attached, so the destination fell back to whichever hostel came first. An
 * owner with two hostels could read "GST number not added", tap it, and edit
 * the other hostel.
 *
 * They now belong to a hostel's own Settings tab, which takes `hostelId` from
 * the route. Every link this builds carries that id forward, so the screen it
 * opens never has to guess.
 *
 * Kept pure so the counting rule — and specifically the rule that a
 * deliberately-off setting is never a gap — can be asserted without rendering.
 */

/** At most this many rows. An unbounded list is a wall, not a signal. */
export const MAX_ATTENTION_ROWS = 2;

export interface AttentionItem {
  title: string;
  sub: string;
  route: string;
}

export interface AttentionSource {
  hostelId: string | null;
  hostel?: {
    name?: string | null;
    phone?: string | null;
    address?: string | null;
    gst_number?: string | null;
  } | null;
  billing?: {
    late_fee?: { enabled?: boolean; rules?: Array<{ amount?: number | null }> } | null;
  } | null;
}

const CONFIG = '/owner/more/configuration';

export function attentionItems({ hostelId, hostel, billing }: AttentionSource): AttentionItem[] {
  // Nothing is claimed before the data is in. An empty policy response is not
  // evidence of a missing GST number.
  if (!hostelId || !hostel) return [];

  const withHostel = (route: string) => `${route}?hostelId=${encodeURIComponent(hostelId)}`;

  const items: AttentionItem[] = [];

  if (!(hostel.name && hostel.phone && hostel.address)) {
    items.push({
      title: 'Hostel identity incomplete',
      sub: 'Add a name, phone and address',
      route: withHostel('/owner/more/hostel'),
    });
  }

  if (!hostel.gst_number) {
    items.push({
      title: 'GST number not added',
      sub: 'Needed only if your receipts show GST',
      route: withHostel('/owner/more/hostel'),
    });
  }

  const lateFee = billing?.late_fee;
  if (lateFee?.enabled && !lateFee.rules?.[0]?.amount) {
    items.push({
      title: 'Late fee amount not set',
      sub: 'Late fees are on but charge nothing',
      route: withHostel(`${CONFIG}/finance/late-fees`),
    });
  }

  return items.slice(0, MAX_ATTENTION_ROWS);
}
