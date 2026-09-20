import { LANGUAGES_MAX, type EditableHost, type HostDraft, type PublicHost } from './types';

/**
 * "Meet your host" (ADR-200) — every decision the card makes, with no React.
 *
 * The respect rules live here so they are asserted, not remembered:
 * the owner is named in full (the button included), a stat that is zero or
 * unknown is left out rather than shown as nothing, and an owner with no
 * words yet still gets a card that leads with their face and name — never an
 * empty quote or "No description yet".
 *
 * `HostCard.tsx` renders this for the Discover listing, the owner's own
 * preview and the admin drawer; one model is why the three cannot drift.
 */

export type HostCardVariant = 'note' | 'compact' | 'platform';

export interface HostStat {
  key: 'rating' | 'residents' | 'since';
  value: string;
  label: string;
}

export interface HostCardModel {
  variant: HostCardVariant;
  heading: string;
  name: string | null;
  initial: string;
  photoUrl: string | null;
  verified: boolean;
  bio: string | null;
  role: string;
  facts: string[];
  stats: HostStat[];
  ctaLabel: string | null;
}

export interface Milestone {
  key: 'residents' | 'rating' | 'since';
  value: string | null;
  label: string;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Own month names: `toLocaleDateString('en-IN')` says "Sept" on some runtimes and "Sep" on others. */
export function formatMonthYear(iso: string | null | undefined, style: 'long' | 'short' = 'long'): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const month = MONTHS[date.getMonth()];
  return `${style === 'short' ? month.slice(0, 3) : month} ${date.getFullYear()}`;
}

export function languagesPhrase(languages: string[]): string | null {
  const list = languages.filter(Boolean);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** The backend floors to the ten from 10 upward; "+" says so. */
export function residentsLabel(count: number): string {
  return count >= 10 ? `${count}+` : String(count);
}

export function hostFacts(host: Pick<PublicHost, 'hosting_since' | 'languages'>): string[] {
  const facts: string[] = [];
  if (host.hosting_since) facts.push(`Running hostels since ${host.hosting_since}`);
  const languages = languagesPhrase(host.languages ?? []);
  if (languages) facts.push(`Speaks ${languages}`);
  return facts;
}

const reviewsLabel = (count: number) => (count === 1 ? '1 review' : `${count} reviews`);

export function hostStats(host: PublicHost, { includeSince }: { includeSince: boolean }): HostStat[] {
  const stats: HostStat[] = [];
  const { review_count, rating, residents } = host.stats ?? { review_count: 0, rating: null, residents: null };
  if (review_count > 0 && rating !== null) {
    stats.push({ key: 'rating', value: `${rating.toFixed(1)}★`, label: reviewsLabel(review_count) });
  }
  if (residents !== null && residents > 0) {
    stats.push({ key: 'residents', value: residentsLabel(residents), label: 'residents' });
  }
  const since = includeSince ? formatMonthYear(host.listed_since, 'short') : null;
  if (since) stats.push({ key: 'since', value: since, label: 'on Stayo since' });
  return stats;
}

export function buildHostCard(
  host: PublicHost | null | undefined,
  { hostelName }: { hostelName?: string | null } = {},
): HostCardModel | null {
  if (!host) return null;

  const since = formatMonthYear(host.listed_since);
  if (host.platform_listed) {
    // A platform listing has no owner account, but its reviewed content may
    // still name the person behind it. Nothing else about a real host (photo,
    // stats, button) is claimed for them.
    const named = host.name?.trim() || null;
    return {
      variant: 'platform',
      heading: named ? `Hosted by ${named}` : 'Listed by Stayo',
      name: named,
      initial: (named ?? 'S').charAt(0).toUpperCase(),
      photoUrl: null,
      verified: false, bio: null,
      role: named ? 'Owner' : since ? `On Stayo since ${since}` : 'On Stayo',
      facts: [], stats: [], ctaLabel: null,
    };
  }

  const name = host.name?.trim() || null;
  const bio = host.bio?.trim() || null;
  const variant: HostCardVariant = bio ? 'note' : 'compact';
  const role =
    variant === 'note'
      ? 'Owner'
      : [hostelName ? `Owner of ${hostelName}` : 'Owner', since ? `On Stayo since ${since}` : null]
          .filter(Boolean)
          .join(' · ');

  return {
    variant,
    heading: 'Meet your host',
    name,
    initial: (name ?? 'S').charAt(0).toUpperCase(),
    photoUrl: host.photo_url || null,
    verified: Boolean(host.verified),
    bio,
    role,
    facts: hostFacts(host),
    stats: hostStats(host, { includeSince: variant === 'note' }),
    ctaLabel: name ? `Enquire with ${name}` : 'Enquire',
  };
}

export interface HostByline {
  /** "Hosted by Shiva Prakash" — the full name, as everywhere else (ADR-200). */
  title: string;
  /** "Owner · On Stayo since Sep 2026", built from whatever is actually known. */
  line: string;
  name: string | null;
  initial: string;
  photoUrl: string | null;
  verified: boolean;
}

/**
 * The one-line host attribution that sits near the top of a listing, above the
 * beds and the rent — Airbnb's "Hosted by …" row.
 *
 * Deliberately carries no bio, no stats and no button: those belong to the
 * full card at the foot of the page. This row answers only "is there a person
 * behind this listing, and who?" before a reader reaches the price.
 */
export function buildHostByline(host: PublicHost | null | undefined): HostByline | null {
  if (!host) return null;

  const since = formatMonthYear(host.listed_since, 'short');
  const photoUrl = host.photo_url || null;

  if (host.platform_listed) {
    const named = host.name?.trim() || null;
    return {
      title: named ? `Hosted by ${named}` : 'Listed by Stayo',
      line: named ? 'Owner' : since ? `On Stayo since ${since}` : 'On Stayo',
      name: named,
      initial: (named ?? 'S').charAt(0).toUpperCase(),
      photoUrl: null,
      verified: false,
    };
  }

  const name = host.name?.trim() || null;
  return {
    title: name ? `Hosted by ${name}` : 'Hosted by the owner',
    line: ['Owner', since ? `On Stayo since ${since}` : null].filter(Boolean).join(' · '),
    name,
    initial: (name ?? 'S').charAt(0).toUpperCase(),
    photoUrl,
    verified: Boolean(host.verified),
  };
}

/** The owner's pride strip: always three tiles, a kind placeholder where a zero would be. */
export function buildMilestones(host: PublicHost): Milestone[] {
  const { review_count, rating, residents } = host.stats;
  return [
    residents !== null && residents > 0
      ? { key: 'residents', value: residentsLabel(residents), label: 'residents welcomed' }
      : { key: 'residents', value: null, label: 'Shows once 5 residents have stayed' },
    review_count > 0 && rating !== null
      ? { key: 'rating', value: `${rating.toFixed(1)}★`, label: `from ${reviewsLabel(review_count)}` }
      : { key: 'rating', value: null, label: 'Your first review will show here' },
    { key: 'since', value: formatMonthYear(host.listed_since, 'short'), label: 'on Stayo since' },
  ];
}

export function draftFrom(host: EditableHost): HostDraft {
  return { bio: host.bio ?? '', languages: host.languages ?? [], hosting_since: host.hosting_since ?? null };
}

export function withDraft<T extends PublicHost>(host: T, draft: HostDraft): T {
  return { ...host, bio: draft.bio.trim() || null, languages: draft.languages, hosting_since: draft.hosting_since };
}

/** What a stranger sees of an editable host — the hide flags applied. */
export function publicView(host: EditableHost): PublicHost {
  const { bio_hidden, photo_hidden, ...rest } = host;
  return { ...rest, bio: bio_hidden ? null : rest.bio, photo_url: photo_hidden ? null : rest.photo_url };
}

export function toggleLanguage(list: string[], language: string, max = LANGUAGES_MAX): string[] {
  if (list.includes(language)) return list.filter((item) => item !== language);
  if (list.length >= max) return list;
  return [...list, language];
}

export function hiddenNotice(host: Pick<EditableHost, 'bio_hidden' | 'photo_hidden'>): string | null {
  const parts = [host.bio_hidden ? 'story' : null, host.photo_hidden ? 'photo' : null].filter(Boolean);
  if (parts.length === 0) return null;
  return `Stayo has hidden your ${parts.join(' and ')} from your public listing. Contact support if you think this is a mistake.`;
}

export function hostingYears(now: Date = new Date()): number[] {
  const years: number[] = [];
  for (let year = now.getFullYear(); year >= 1950; year -= 1) years.push(year);
  return years;
}
