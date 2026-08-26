/**
 * What the profile hub shows, and — more to the point — what it doesn't.
 *
 * ## The rule this module exists to enforce
 *
 * **A profile should tell you what is missing, not recite what you already
 * know.** The screen this replaced printed "Full name: speakcode" and "Date of
 * birth: 21 May 2006" back at the person whose name and birthday those are,
 * across four cards and eight key-value rows — roughly 470px to teach someone
 * nothing. Where a field was blank it printed an em-dash, so "Academic
 * details" spent a whole card saying "—" twice.
 *
 * So detail rows carry no values. The right-hand side carries the *gap*, or
 * nothing at all. "Nothing on the right" becomes a real signal — it means
 * there is nothing to do here — which is only true because a filled field is
 * never mentioned.
 *
 * PURE — no React, no DOM. The hub renders this.
 */

/** Field label as it appears inside a sentence: "Add college". */
interface Field {
  label: string;
  value: unknown;
}

function filled(value: unknown): boolean {
  if (value == null) return false;
  const text = String(value).trim();
  return text.length > 0 && text !== '—' && text !== '-';
}

export type ProfileType = 'STUDENT' | 'WORKING_PROFESSIONAL' | string;

export interface DetailSources {
  tenant?: Record<string, any> | null;
  profile?: Record<string, any> | null;
  contacts?: Record<string, any> | null;
}

/**
 * The four tenancy detail groups, described by what each *needs* rather than
 * what it displays. Order matches the screen.
 */
export function detailFields(key: string, { tenant, profile, contacts }: DetailSources): Field[] {
  const t = tenant ?? {};
  const p = profile ?? {};
  const c = contacts ?? {};

  switch (key) {
    case 'personal_info':
      return [
        { label: 'your name', value: p.name },
        { label: 'date of birth', value: t.date_of_birth },
      ];
    case 'contact_info':
      return [
        { label: 'phone', value: c.tenant_phone?.value ?? p.phone },
        { label: 'email', value: p.email ?? p.account_email },
      ];
    case 'emergency_info':
      return [
        { label: 'a guardian', value: t.guardian_name },
        { label: 'their phone', value: c.guardian_phone?.value ?? t.guardian_phone ?? t.phone_2 },
      ];
    case 'academic_info':
      // A working professional is not missing a college, and telling them to
      // add one is how a form loses someone's trust in a single line.
      return t.profile_type === 'WORKING_PROFESSIONAL'
        ? [
            { label: 'company', value: t.office_name },
            { label: 'role', value: t.job_role },
          ]
        : [
            { label: 'college', value: t.college_name },
            { label: 'course', value: t.course },
          ];
    default:
      return [];
  }
}

/** The labels of everything still blank in this group. */
export function missingIn(key: string, sources: DetailSources): string[] {
  return detailFields(key, sources)
    .filter((field) => !filled(field.value))
    .map((field) => field.label);
}

/**
 * The one line that sits on the right of a detail row.
 *
 * `null` when the group is complete — a filled field earns silence, which is
 * what makes a hint mean something when it does appear. Two gaps are named
 * rather than counted ("Add college & course"), because "2 missing" makes
 * someone tap to find out what, and the tap is the cost the row exists to
 * avoid. Three or more would be a wall, so those do count.
 */
export function gapHint(key: string, sources: DetailSources): string | null {
  const missing = missingIn(key, sources);
  if (missing.length === 0) return null;
  if (missing.length === 1) return `Add ${missing[0]}`;
  if (missing.length === 2) return `Add ${missing[0]} & ${missing[1]}`;
  return `${missing.length} to add`;
}

/** Every gap across every group — the number worth putting on the section. */
export function totalGaps(keys: string[], sources: DetailSources): number {
  return keys.reduce((sum, key) => sum + missingIn(key, sources).length, 0);
}

/**
 * Which single card leads the page.
 *
 * Never both. The old hub stacked a 200px "your details travel with you" pitch
 * — written for someone who has not enquired yet — on top of the card saying
 * which room they already live in. Someone with a live tenancy has taken the
 * offer; repeating it is the app talking to itself.
 */
export type HeroMode = 'stay' | 'portable' | 'none';

export function heroMode(input: { hasLiveStay: boolean; identityComplete: boolean | null }): HeroMode {
  if (input.hasLiveStay) return 'stay';
  // A seeker whose portable profile is already complete does not need the
  // pitch either — they need the rest of the page.
  if (input.identityComplete === true) return 'none';
  return 'portable';
}

/**
 * A count for the right of a row: `0` reads as absence, so it is shown as a
 * dash rather than a number someone has to interpret as "none".
 */
export function countMeta(value: number | null | undefined): string {
  const count = Number(value ?? 0);
  return count > 0 ? String(count) : '—';
}

/** "1 stay · including this one" style line, kept short enough for a row. */
export function stayMeta(stays: number | null | undefined): string {
  const count = Number(stays ?? 0);
  if (count === 0) return 'Nothing yet';
  return count === 1 ? '1 stay' : `${count} stays`;
}
