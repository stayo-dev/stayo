/**
 * The Help Centre's decision logic — who owns a problem, and what to do about
 * it before anyone files anything.
 *
 * ## Two inboxes, one wall between them
 *
 * A hostel resident with a broken geyser and a hostel resident who cannot log
 * in have both "got a problem", and every instinct they have says to describe
 * it in whatever box is nearest. But those two problems belong to different
 * organisations:
 *
 * - **HOSTEL** — the geyser, the food, the roommate, the rent amount. The
 *   hostel team owns these. Stayo carries them (`tenant_service_requests`) so
 *   the owner can work them and so we have context, and that is the whole of
 *   our involvement. We do not answer them.
 * - **STAYO** — the app, the login, the payment that failed at the gateway,
 *   the screen that went blank. Ours, and admin-managed
 *   (`platform_support_tickets`).
 *
 * `classifyProblem` is that wall, applied at the only moment it matters: while
 * someone is typing. Getting it wrong in either direction is expensive —
 * a geyser filed to Stayo waits for an admin who cannot fix geysers, and a
 * login bug filed to the hostel waits for an owner who cannot fix logins.
 *
 * ## Guidance before a form
 *
 * The support-ticket table had **zero rows** and the owner's "Report a Bug"
 * button was a "Coming soon" toast. Both facts point the same way: people were
 * not being helped, and the fix is not a bigger form. Most reports are not
 * bugs — they are someone who cannot find a screen. So the catalogue below is
 * searched first, and every entry that can be resolved by *going somewhere*
 * carries the link rather than describing the path. Telling someone "open the
 * Payments tab" when you could open it for them is a worse answer.
 *
 * PURE — no React, no DOM, no network. The components are renderers over this.
 */

export type HelpAudience = 'owner' | 'tenant';

/** Who has to act. `UNSURE` means say nothing rather than guess wrong. */
export type ProblemOwner = 'HOSTEL' | 'STAYO' | 'UNSURE';

/** Mirrors the backend's `TICKET_CATEGORIES`. Changing one requires the other. */
export type TicketCategory = 'APP_BUG' | 'ACCOUNT_ISSUE' | 'PAYMENT_ISSUE' | 'OTHER';

export interface HelpAction {
  label: string;
  /** A real route. Every one of these is checked against the router's table. */
  to: string;
}

export interface HelpGuide {
  id: string;
  audience: HelpAudience[];
  /** Phrased as the person would say it, not as we would file it. */
  question: string;
  answer: string;
  /** Present when the answer is a place, which is most of the time. */
  action?: HelpAction;
  /** Words someone might type that this answers but the question does not contain. */
  keywords: string[];
}

/**
 * The catalogue.
 *
 * Every entry earns its place by being something a real person hits: a screen
 * they cannot find, a delay they read as a failure, or a boundary they cannot
 * be expected to know (that listing edits are reviewed, that rent is the
 * hostel's number and not ours).
 */
export const HELP_GUIDES: HelpGuide[] = [
  // ---- Tenant -------------------------------------------------------------
  {
    id: 'tenant-rent-still-due',
    audience: ['tenant'],
    question: 'I paid my rent but it still shows as due',
    answer:
      'An online payment can take a few minutes to reconcile. Open Payments and pull down to refresh — if it is still due after 30 minutes, that is ours to fix and worth reporting below.',
    action: { label: 'Open Payments', to: '/tenant/money' },
    keywords: ['paid', 'rent', 'due', 'outstanding', 'upi', 'not reflecting', 'pending'],
  },
  {
    id: 'tenant-receipt',
    audience: ['tenant'],
    question: 'Where do I find my rent receipt?',
    answer: 'Every settled payment has a receipt against it under Payments.',
    action: { label: 'Open Payments', to: '/tenant/money' },
    keywords: ['receipt', 'invoice', 'proof', 'download', 'bill'],
  },
  {
    id: 'tenant-room-broken',
    audience: ['tenant'],
    question: 'Something in my room is broken',
    answer:
      'Water, power, furniture, cleaning, food, your roommates — your hostel team handles all of it, and they see your request the moment you raise it. Stayo does not repair rooms, so filing it here would only slow it down.',
    action: { label: 'Tell your hostel', to: '/tenant/complaints' },
    keywords: [
      'broken', 'water', 'geyser', 'hot water', 'ac', 'fan', 'light', 'bulb', 'leak',
      'toilet', 'bathroom', 'dirty', 'clean', 'noise', 'roommate', 'food', 'mess',
      'repair', 'maintenance', 'power', 'cockroach', 'pest',
    ],
  },
  {
    id: 'tenant-rent-wrong',
    audience: ['tenant'],
    question: 'My rent or deposit amount looks wrong',
    answer:
      'Your hostel sets those numbers — Stayo only shows what they have entered. Raise it with them and they can correct it at source.',
    action: { label: 'Tell your hostel', to: '/tenant/complaints' },
    keywords: ['rent amount', 'deposit', 'too much', 'wrong amount', 'overcharged', 'late fee'],
  },
  {
    id: 'tenant-room-empty',
    audience: ['tenant'],
    question: 'My room or hostel details are empty',
    answer:
      'Room details appear once your hostel has assigned you a bed and filled them in. If you have moved in and it is still blank, ask your hostel to complete it.',
    action: { label: 'Open my Room', to: '/tenant/room' },
    keywords: ['empty', 'blank', 'no room', 'missing', 'not showing', 'facilities', 'wifi'],
  },
  {
    id: 'tenant-move-out',
    audience: ['tenant'],
    question: 'I want to move out',
    answer:
      'You can start it yourself from your Room. You will be asked for a date and a reason, and nothing is final until your hostel confirms the settlement.',
    action: { label: 'Start move-out', to: '/tenant/room' },
    keywords: ['move out', 'leave', 'vacate', 'notice', 'quit', 'shifting'],
  },
  {
    id: 'tenant-documents',
    audience: ['tenant'],
    question: 'I need to upload or replace a document',
    answer: 'Your ID and agreement documents live in your profile and can be replaced any time.',
    action: { label: 'Open Documents', to: '/profile/documents' },
    keywords: ['document', 'aadhaar', 'id proof', 'kyc', 'upload', 'agreement'],
  },

  // ---- Owner --------------------------------------------------------------
  {
    id: 'owner-listing-not-live',
    audience: ['owner'],
    question: 'My photos or amenities are not showing on Discover',
    answer:
      'Listing edits go to Stayo for a quick review before they go public — that is what keeps every listing on Discover trustworthy. Your hostel page shows whether the current version is in review or live.',
    action: { label: 'Open my hostel', to: '/owner/more/hostel' },
    keywords: [
      'discover', 'listing', 'photos', 'amenities', 'not showing', 'review',
      'pending', 'live', 'publish', 'facilities',
    ],
  },
  {
    id: 'owner-cannot-edit-listing',
    audience: ['owner'],
    question: 'I cannot edit my amenities or listing right now',
    answer:
      'While a version is in review it is locked, so your submitted copy and the live copy cannot drift apart. It unlocks as soon as Stayo approves or returns it — usually the same day.',
    action: { label: 'Check review status', to: '/owner/more/hostel' },
    keywords: ['cannot edit', 'locked', 'disabled', 'greyed', 'amenities', 'read only'],
  },
  {
    id: 'owner-payment-not-showing',
    audience: ['owner'],
    question: 'A tenant paid me but the dashboard does not show it',
    answer:
      'Cash and direct bank transfers are not visible to Stayo — record them under Money and the tenant’s dues update immediately. Online payments appear on their own within a few minutes.',
    action: { label: 'Record a payment', to: '/owner/money/collect' },
    keywords: ['payment', 'cash', 'paid', 'not showing', 'record', 'collect', 'transfer'],
  },
  {
    id: 'owner-payout',
    audience: ['owner'],
    question: 'My payout has not arrived',
    answer:
      'Online collections settle to your bank on a schedule rather than instantly. Payouts shows what has been sent and what is still due to you.',
    action: { label: 'Open Payouts', to: '/owner/money/payouts' },
    keywords: ['payout', 'settlement', 'bank', 'money not received', 'transfer', 'withdraw'],
  },
  {
    id: 'owner-tenant-complaints',
    audience: ['owner'],
    question: 'Where do I see complaints from my tenants?',
    answer:
      'Everything your residents raise about the hostel lands in Service requests. These are yours to resolve — Stayo carries them so you have one list, and does not answer them for you.',
    action: { label: 'Open Service requests', to: '/owner/more/service-requests' },
    keywords: ['complaint', 'service request', 'tenant issue', 'maintenance', 'ticket'],
  },
  {
    id: 'owner-invite-tenant',
    audience: ['owner'],
    question: 'A tenant I invited has not appeared',
    answer:
      'An invite stays pending until the tenant opens it and finishes activation. Activations shows who has been sent one and where each has got to, and lets you resend.',
    action: { label: 'Open Activations', to: '/owner/tenants/activations' },
    keywords: ['invite', 'invitation', 'activation', 'pending', 'not joined', 'whatsapp', 'resend'],
  },
  {
    id: 'owner-wifi',
    audience: ['owner'],
    question: 'How do I set the Wi-Fi name and password?',
    answer:
      'Per room, from your hostel’s Rooms tab. Whatever you enter is shown to the tenants in that room and to nobody else.',
    action: { label: 'Open my hostel', to: '/owner/more/hostel' },
    keywords: ['wifi', 'wi-fi', 'password', 'internet', 'network', 'room'],
  },
  {
    id: 'owner-late-fees',
    audience: ['owner'],
    question: 'How do I change rent dates, late fees or the deposit?',
    answer: 'All of the money rules live together under Configuration → Finance.',
    action: { label: 'Open Finance settings', to: '/owner/more/configuration/finance' },
    keywords: ['late fee', 'rent date', 'due date', 'deposit', 'billing', 'schedule', 'penalty'],
  },
  {
    id: 'owner-vacant-beds',
    audience: ['owner'],
    question: 'I cannot add a tenant to a room',
    answer:
      'A tenant can only be placed on a bed that is free. Vacant beds shows what is actually available across your hostel right now.',
    action: { label: 'Open Vacant beds', to: '/owner/rooms/vacant' },
    keywords: ['add tenant', 'assign', 'bed', 'full', 'no room', 'occupancy', 'vacant'],
  },

  // ---- Both ---------------------------------------------------------------
  {
    id: 'both-otp',
    audience: ['owner', 'tenant'],
    question: 'My OTP has not arrived',
    answer:
      'The code comes on WhatsApp, not SMS — check that number’s WhatsApp first. It can take up to a minute; after that, request a new one. If several attempts in a row fail, report it below and include the number you used.',
    keywords: ['otp', 'code', 'not received', 'sms', 'whatsapp', 'verify', 'verification'],
  },
  {
    id: 'both-change-phone',
    audience: ['owner', 'tenant'],
    question: 'I want to change my phone number or email',
    answer:
      'You can change both from your profile. A new phone number needs an OTP before it replaces the old one — that is what keeps someone else from taking over an account.',
    action: { label: 'Open Profile', to: '/profile/details' },
    keywords: ['phone', 'number', 'email', 'change', 'update', 'wrong number', 'mobile'],
  },
  {
    id: 'both-signed-out',
    audience: ['owner', 'tenant'],
    question: 'I keep getting signed out',
    answer:
      'You should stay signed in on your own device for a week at a time. Being signed out sooner than that, repeatedly, is a bug on our side — report it below and say roughly how long it took.',
    keywords: ['logged out', 'signed out', 'session', 'expired', 'login again', 'keeps'],
  },
];

/** Everything that could plausibly be shown to this audience. */
export function guidesFor(audience: HelpAudience): HelpGuide[] {
  return HELP_GUIDES.filter((guide) => guide.audience.includes(audience));
}

/** Lowercased words of 2+ characters. Punctuation is not a search term. */
function tokenise(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 1);
}

/**
 * Guides matching what someone typed, best first.
 *
 * A keyword hit scores above a question hit: someone who types "geyser" means
 * the entry whose keywords carry "geyser" far more surely than one that merely
 * happens to share the word "room" with them.
 *
 * An empty query returns the whole list rather than nothing — the catalogue is
 * short enough to browse, and a blank screen would hide the answers from
 * exactly the people who do not yet know what to call their problem.
 */
export function searchGuides(query: string, audience: HelpAudience): HelpGuide[] {
  const available = guidesFor(audience);
  const words = tokenise(query);
  if (words.length === 0) return available;

  const scored = available.map((guide) => {
    const haystack = tokenise(guide.question).join(' ');
    const keywords = guide.keywords.map((k) => k.toLowerCase());
    let score = 0;
    for (const word of words) {
      if (keywords.some((keyword) => keyword.includes(word))) score += 3;
      else if (haystack.includes(word)) score += 2;
      else if (guide.answer.toLowerCase().includes(word)) score += 1;
    }
    return { guide, score };
  });

  return scored
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.guide);
}

/**
 * Words that mean the hostel has to act. Physical things, and the numbers the
 * hostel chooses.
 */
const HOSTEL_SIGNALS = [
  'geyser', 'hot water', 'water', 'tap', 'leak', 'seepage', 'plumbing', 'toilet',
  'bathroom', 'washroom', 'ac ', 'fan', 'bulb', 'light', 'switch', 'furniture',
  'bed', 'mattress', 'cupboard', 'almirah', 'door', 'window', 'lock',
  'clean', 'cleaning', 'dirty', 'garbage', 'dustbin', 'cockroach', 'pest', 'rat',
  'food', 'mess', 'meal', 'breakfast', 'lunch', 'dinner', 'tiffin', 'cook',
  'roommate', 'neighbour', 'noise', 'noisy', 'smoking', 'fight',
  'warden', 'watchman', 'guard', 'gate', 'curfew', 'house rule',
  'laundry', 'washing machine', 'parking', 'lift', 'power cut', 'generator',
  'electricity', 'internet slow', 'wifi not working', 'hostel',
];

/**
 * Words that mean Stayo has to act. Screens, accounts, and the gateway.
 *
 * Deliberately narrower than the hostel list: an unsure verdict costs us a
 * gentle question, while a wrong STAYO verdict costs a resident days of
 * waiting on an admin who was never able to help.
 */
const STAYO_SIGNALS = [
  'app', 'website', 'page', 'screen', 'button', 'crash', 'crashed', 'freeze',
  'frozen', 'stuck', 'blank', 'loading', 'spinner', 'error', 'bug', 'glitch',
  'login', 'log in', 'sign in', 'signin', 'signed out', 'logged out', 'password',
  'otp', 'account', 'verify', 'verification', 'notification',
  'gateway', 'razorpay', 'transaction failed', 'payment failed', 'money deducted',
  'receipt', 'download', 'refresh', 'not loading', 'not opening',
];

function containsAny(haystack: string, signals: string[]): boolean {
  return signals.some((signal) => haystack.includes(signal));
}

/**
 * Whose problem is this?
 *
 * Called while someone types into the Stayo report box, so that a hostel
 * problem can be redirected before it is filed rather than after it has sat
 * unread. When both kinds of word appear ("the app won't let me report my
 * geyser"), STAYO wins: the sentence is about the tool failing, and that one
 * really is ours.
 */
export function classifyProblem(text: string): ProblemOwner {
  const haystack = ` ${String(text ?? '').toLowerCase()} `;
  const stayo = containsAny(haystack, STAYO_SIGNALS);
  const hostel = containsAny(haystack, HOSTEL_SIGNALS);

  if (stayo) return 'STAYO';
  if (hostel) return 'HOSTEL';
  return 'UNSURE';
}

/**
 * The likeliest ticket category, so the reporter does not have to classify
 * their own problem before we will accept it. Always overridable in the UI —
 * this is a starting position, not a verdict.
 */
export function suggestCategory(text: string): TicketCategory {
  const haystack = ` ${String(text ?? '').toLowerCase()} `;
  if (containsAny(haystack, ['payment', 'paid', 'refund', 'money', 'razorpay', 'upi', 'receipt', 'deducted', 'payout', 'rent'])) {
    return 'PAYMENT_ISSUE';
  }
  if (containsAny(haystack, ['login', 'log in', 'sign in', 'password', 'otp', 'account', 'verify', 'signed out', 'locked out', 'email', 'phone number'])) {
    return 'ACCOUNT_ISSUE';
  }
  if (containsAny(haystack, ['crash', 'error', 'bug', 'blank', 'stuck', 'loading', 'button', 'page', 'screen', 'broken', 'glitch', 'freeze'])) {
    return 'APP_BUG';
  }
  return 'OTHER';
}

export const CATEGORY_LABEL: Record<TicketCategory, string> = {
  APP_BUG: 'App or website bug',
  ACCOUNT_ISSUE: 'Account issue',
  PAYMENT_ISSUE: 'Payment issue',
  OTHER: 'Something else',
};

export const TICKET_CATEGORIES: TicketCategory[] = ['APP_BUG', 'ACCOUNT_ISSUE', 'PAYMENT_ISSUE', 'OTHER'];

/** A report needs enough words to be actionable, not merely non-empty. */
export const MIN_DESCRIPTION_LENGTH = 15;

export function canSubmitReport(subject: string, description: string): boolean {
  return String(subject ?? '').trim().length > 0
    && String(description ?? '').trim().length >= MIN_DESCRIPTION_LENGTH;
}

/**
 * Where a tenant should take a hostel problem, and where an owner should.
 *
 * The owner case is not a redirect to someone else — the owner *is* the hostel
 * team. Sending them to their own service-request list is the honest answer.
 */
export function hostelChannel(audience: HelpAudience): HelpAction {
  return audience === 'tenant'
    ? { label: 'Tell your hostel instead', to: '/tenant/complaints' }
    : { label: 'Open Service requests', to: '/owner/more/service-requests' };
}

/**
 * What we promise after a report is filed, shown instead of a toast that
 * disappears. Being heard means seeing that the thing you wrote landed
 * somewhere with a name on it.
 */
export const REPORT_ACK = {
  title: 'We have got it',
  body: 'This is with the Stayo team now. You will see the reply right here on this page, and we usually come back within a day.',
} as const;
