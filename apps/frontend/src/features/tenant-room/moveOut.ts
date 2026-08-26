/**
 * Asking to move out.
 *
 * The backend has accepted tenant-initiated move-outs all along —
 * `POST /api/move-out/requests` reads the session and sets
 * `initiatedByRole = "TENANT"` itself — and feeds a real owner pipeline
 * (vacate → inspect → settle). There was simply no way for a tenant to say so.
 *
 * PURE — the sheet is a renderer over this.
 */

/**
 * Which reasons the hostel could still do something about.
 *
 * This is the whole point of asking *why* before asking *when*. Someone leaving
 * because their course ended is not a problem to solve — wishing them well is
 * the only correct response, and putting an obstacle in front of them would be
 * insulting. Someone leaving over a broken geyser, a roommate, or the food is
 * describing a fixable thing that nobody has been told about, and they will
 * usually not raise it themselves: leaving is easier than complaining.
 *
 * So the flow offers to raise it — once, without nagging — and moving out stays
 * one tap away either way. A retention prompt that makes leaving *harder* is a
 * dark pattern; one that makes being heard *easier* is a service.
 */
export const ADDRESSABLE_REASONS = [
  'POOR_MAINTENANCE',
  'FOOD_QUALITY',
  'ROOMMATE_ISSUES',
  'SAFETY_CONCERNS',
  'RULES_TOO_STRICT',
  'TOO_EXPENSIVE',
] as const;

/** Whether the hostel can plausibly act on this, given the chance. */
export function isAddressable(reason: string): boolean {
  return (ADDRESSABLE_REASONS as readonly string[]).includes(reason);
}

/**
 * What to offer when a reason is addressable — specific to the reason, because
 * "we'd like to help" is noise and "we'll ask them to look at the hot water
 * this week" is not.
 */
export function retentionOffer(reason: string): { headline: string; body: string; action: string } | null {
  const offers: Record<string, { headline: string; body: string; action: string }> = {
    POOR_MAINTENANCE: {
      headline: 'Let us get it fixed first',
      body: 'Raise it with your hostel and give them a few days. If nothing changes, moving out is still right here.',
      action: 'Report the problem instead',
    },
    FOOD_QUALITY: {
      headline: 'Your hostel can change the menu',
      body: 'Food is the thing owners change most often when someone actually tells them. Worth one message first.',
      action: 'Tell them about the food',
    },
    ROOMMATE_ISSUES: {
      headline: 'A room change might be enough',
      body: 'You do not have to leave the hostel to leave the room. Ask about moving beds first.',
      action: 'Ask for a room change',
    },
    SAFETY_CONCERNS: {
      headline: 'Tell us what happened',
      body: 'Safety is not something to move quietly away from. Your hostel and Stayo should both know.',
      action: 'Report it',
    },
    RULES_TOO_STRICT: {
      headline: 'Worth asking before you go',
      body: 'Some rules are firm and some are habit. Owners often do not know which ones are pushing people out.',
      action: 'Raise it with them',
    },
    TOO_EXPENSIVE: {
      headline: 'Talk to your hostel first',
      body: 'Rent, sharing and room type are sometimes negotiable — especially for someone who has already stayed a while.',
      action: 'Ask about options',
    },
  };
  return offers[reason] ?? null;
}

/** Mirrors the `MoveOutReason` enum. Order is the order a tenant reads them. */
export const MOVE_OUT_REASONS = [
  { value: 'COURSE_COMPLETED', label: 'My course finished' },
  { value: 'JOB_RELOCATION', label: 'Job or internship elsewhere' },
  { value: 'MOVING_CLOSER', label: 'Moving closer to college or work' },
  { value: 'TOO_EXPENSIVE', label: 'Too expensive' },
  { value: 'ROOMMATE_ISSUES', label: 'Roommate issues' },
  { value: 'POOR_MAINTENANCE', label: 'Maintenance problems' },
  { value: 'FOOD_QUALITY', label: 'Food quality' },
  { value: 'SAFETY_CONCERNS', label: 'Safety concerns' },
  { value: 'RULES_TOO_STRICT', label: 'Rules are too strict' },
  { value: 'BETTER_HOSTEL', label: 'Found somewhere better' },
  { value: 'PERSONAL_REASONS', label: 'Personal reasons' },
  { value: 'OTHER', label: 'Something else' },
] as const;

export type MoveOutReasonValue = (typeof MOVE_OUT_REASONS)[number]['value'];

/** `YYYY-MM-DD` for today, from local parts — never `toISOString()`, which is UTC. */
export function todayISO(now: Date): string {
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${mm}-${dd}`;
}

export type MoveOutValidation = { ok: boolean; message: string };

/**
 * Whether this request can be sent.
 *
 * Deliberately permissive about *when*: this asks the owner, it does not
 * announce a departure, and a tenant whose plans changed yesterday should still
 * be able to raise it. The only date it refuses is one in the past, which is a
 * typo rather than an intention.
 *
 * "Something else" asks for a sentence, because an owner receiving `OTHER` with
 * no text has been told nothing at all.
 */
export function validateMoveOut(input: {
  reason: string;
  reasonText: string;
  plannedExitDate: string;
  today: string;
}): MoveOutValidation {
  if (!input.reason) return { ok: false, message: 'Pick a reason so the hostel knows what to do' };
  if (input.reason === 'OTHER' && !input.reasonText.trim()) {
    return { ok: false, message: 'Tell them briefly what’s changed' };
  }
  if (!input.plannedExitDate) return { ok: false, message: 'Choose the date you plan to leave' };
  if (input.plannedExitDate < input.today) {
    return { ok: false, message: 'That date has already passed' };
  }
  if (input.reasonText.length > 1000) {
    return { ok: false, message: 'Keep it under 1000 characters' };
  }
  return { ok: true, message: '' };
}

/**
 * What actually happens next, said plainly.
 *
 * A generic "Are you sure?" tells nobody anything. Moving out starts a
 * settlement of the deposit and dues, frees the bed, and puts the request in
 * front of the owner — a tenant is entitled to know that before tapping, not
 * after.
 */
export function moveOutConsequences(): string[] {
  return [
    'Your hostel is notified and will confirm the date with you.',
    'Your deposit and any dues are settled after you leave.',
    'Your bed becomes available for someone else from that date.',
  ];
}

/**
 * The parting feedback.
 *
 * Someone leaving is the most honest reviewer a hostel will ever have — they
 * have nothing left to lose and no reason to flatter. It is also the last
 * moment they will ever be asked, so asking badly means never knowing.
 *
 * Kept to two questions and both optional. A move-out that is *blocked* on a
 * survey is a survey nobody finishes and a move-out that turns into a support
 * ticket.
 */
export interface MoveOutFeedback {
  /** 1–5 for the stay overall. 0 means they skipped it. */
  rating: number;
  /** What would have made them stay. Free text, and often the only useful part. */
  note: string;
}

export function hasFeedback(feedback: MoveOutFeedback): boolean {
  return feedback.rating > 0 || feedback.note.trim().length > 0;
}

/**
 * Where a rating lands.
 *
 * A leaving tenant's rating is a **hostel review** — the same
 * `hostel_reviews` record any resident can leave — not a private note to the
 * owner. Two rating systems for one hostel would disagree within a week, and
 * the one nobody can see is the one that gets ignored.
 *
 * The written note is different: it goes to the hostel and to Stayo, unpublished,
 * because "the third-floor bathroom has been broken since June" is operational,
 * not a review, and a person on their way out should be able to say it without
 * publishing it under their name.
 */
export function feedbackDestinations(feedback: MoveOutFeedback): { review: boolean; privateNote: boolean } {
  return {
    review: feedback.rating > 0,
    privateNote: feedback.note.trim().length > 0,
  };
}

/**
 * Where a "raise it instead" actually files.
 *
 * `ServiceRequestType` is a Postgres enum with six values and no general
 * complaint among them, and adding one needs a hand-applied migration. So the
 * type is the closest honest fit and `category` — free text the owner reads —
 * carries the real subject.
 *
 * **The imprecision is real and worth naming:** a complaint about food or rent
 * files as `MAINTENANCE`, because that is the only bucket wide enough. The
 * category is what makes it legible; a `COMPLAINT` enum value would make it
 * correct, and that is a migration nobody has run.
 */
export function raiseTarget(reason: string): { type: string; category: string; prompt: string } | null {
  const targets: Record<string, { type: string; category: string; prompt: string }> = {
    POOR_MAINTENANCE: {
      type: 'MAINTENANCE',
      category: 'Maintenance',
      prompt: 'What is broken, and how long has it been like that?',
    },
    SAFETY_CONCERNS: {
      type: 'MAINTENANCE',
      category: 'Safety concern',
      prompt: 'What happened? Include when and where if you can.',
    },
    ROOMMATE_ISSUES: {
      type: 'ROOM_CHANGE',
      category: 'Roommate issue',
      prompt: 'What is going on, and would a different room help?',
    },
    FOOD_QUALITY: {
      type: 'MAINTENANCE',
      category: 'Food quality',
      prompt: 'Which meals, and what would you change about them?',
    },
    RULES_TOO_STRICT: {
      type: 'MAINTENANCE',
      category: 'House rules',
      prompt: 'Which rule, and what would work better for you?',
    },
    TOO_EXPENSIVE: {
      type: 'MAINTENANCE',
      category: 'Rent',
      prompt: 'What would make it workable — a different room, or a different rate?',
    },
  };
  return targets[reason] ?? null;
}
