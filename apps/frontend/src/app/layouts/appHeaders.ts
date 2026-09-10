/**
 * Topbar title + subtitle per route for the desktop shell (`AppConsoleShell`),
 * modelled on the admin console's `platforms/admin/layout/pageHeaders.ts`.
 *
 * On mobile these strings live inside each page's own header; on desktop the
 * shell's topbar owns them so the page body can start with content. Kept as a
 * plain map (not derived from the nav config) because sub-routes —
 * `/owner/tenants/:id`, `/owner/money/collect` — need their own copy and a
 * dynamic segment can't be a map key.
 *
 * `headerFor` resolves the longest matching prefix, so `/owner/tenants/abc123`
 * falls through to the `/owner/tenants` entry, and an unmapped route gets a
 * quiet generic fallback rather than an empty bar.
 */
export interface PageHeader {
  title: string;
  subtitle?: string;
}

export const PAGE_HEADERS: Record<string, PageHeader> = {
  // ── Owner ──────────────────────────────────────────────────────────────
  '/owner/home': { title: 'Home', subtitle: "Today's rent, this month's cash, and what needs doing" },
  '/owner/tenants': { title: 'Tenants', subtitle: 'Everyone across your hostels' },
  '/owner/tenants/activations': { title: 'Activate tenants', subtitle: 'Invited residents still finishing setup' },
  '/owner/tenants/verifications': { title: 'Verify documents', subtitle: 'KYC uploads awaiting your review' },
  '/owner/money': { title: 'Money', subtitle: 'Collections, expenses and payouts' },
  '/owner/money/collect': { title: "Today's collection", subtitle: 'Rent overdue or due this week, in priority order' },
  '/owner/money/payouts': { title: 'Money in', subtitle: 'Every payout Stayo has made or owes you' },
  '/owner/food': { title: 'Meal planner', subtitle: "What you're serving, and what's next" },
  '/owner/food/meal-plan': { title: 'Weekly meal plan', subtitle: 'Timings and the week’s menu' },
  '/owner/food/kitchen': { title: 'Kitchen sheet', subtitle: 'The printable menu for the kitchen' },
  '/owner/food/polls': { title: 'Food polls', subtitle: 'Ask residents what to cook' },
  '/owner/hostels': { title: 'Hostels', subtitle: 'Your properties' },
  '/owner/hostels/new': { title: 'Add a hostel', subtitle: 'Name it, raise the floors, fill the rooms' },
  '/owner/alerts': { title: 'Alerts', subtitle: 'Leads, messages, renewals and tenant requests' },
  '/owner/agreements/review': { title: 'Review agreements', subtitle: 'Renewals and agreements needing a decision' },
  '/owner/rooms/vacant': { title: 'Fill vacant beds', subtitle: 'Empty beds across your hostels' },
  '/owner/more': { title: 'Settings', subtitle: 'Your account and each hostel’s rules' },

  // ── Tenant ─────────────────────────────────────────────────────────────
  '/tenant/home': { title: 'Home', subtitle: "What's happening at your hostel" },
  '/tenant/room': { title: 'My room', subtitle: 'Everything about your living space' },
  '/tenant/food': { title: 'My menu', subtitle: 'Your meals this week' },
  '/tenant/money': { title: 'Payments', subtitle: 'What you owe, what you’ve paid, and your receipts' },
  '/tenant/notifications': { title: 'Notifications', subtitle: '' },
  '/tenant/complaints': { title: 'Complaints', subtitle: 'Tell your hostel what needs fixing, and follow it here' },
  '/tenant/renewal': { title: 'Agreement renewal', subtitle: '' },

  // ── Shared ─────────────────────────────────────────────────────────────
  '/profile': { title: 'Your account', subtitle: '' },
  '/profile/details': { title: 'Your details', subtitle: 'Fill these in once — every hostel opens pre-filled' },
  '/profile/documents': { title: 'Documents', subtitle: '' },
  '/profile/history': { title: 'Stay history', subtitle: '' },
  '/profile/alerts': { title: 'Alerts', subtitle: 'Everything Stayo has told you' },
  '/profile/tickets': { title: 'Help', subtitle: 'Answers, or report a problem to Stayo' },
  '/profile/saved': { title: 'Saved hostels', subtitle: '' },
  '/profile/enquiries': { title: 'Enquiries', subtitle: '' },
};

const FALLBACK: PageHeader = { title: 'Stayo', subtitle: '' };

export function headerFor(pathname: string): PageHeader {
  if (PAGE_HEADERS[pathname]) return PAGE_HEADERS[pathname];
  // Longest-prefix match, so a detail route inherits its section's header.
  const match = Object.keys(PAGE_HEADERS)
    .filter((base) => pathname === base || pathname.startsWith(`${base}/`))
    .sort((a, b) => b.length - a.length)[0];
  return match ? PAGE_HEADERS[match] : FALLBACK;
}
