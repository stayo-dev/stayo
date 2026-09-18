/**
 * Which page `/` serves — and how to switch back.
 *
 * The audience chooser (`WelcomePage`, ADR-071) is NOT deleted. Both front
 * doors ship in the same bundle and `/` picks one, so reverting is a config
 * change rather than a revert commit:
 *
 *   - `?homepage=chooser` on the URL wins, for looking at either one on a
 *     deployed build without shipping anything;
 *   - else `VITE_HOMEPAGE` (`v2` | `chooser`) decides, set per environment;
 *   - else the default below.
 *
 * Both are also reachable at their own permanent URLs regardless of this —
 * `/welcome` is always the chooser and `/home-v2` is always the new homepage —
 * so neither can become unreachable by a bad flag value.
 */
export type HomepageVersion = 'v2' | 'chooser';

/** What `/` serves when nothing says otherwise. */
export const DEFAULT_HOMEPAGE_VERSION: HomepageVersion = 'v2';

/** The query parameter that overrides everything, for previewing. */
export const HOMEPAGE_QUERY_PARAM = 'homepage';

function asVersion(value: string | null | undefined): HomepageVersion | null {
  if (value === 'v2' || value === 'chooser') return value;
  return null;
}

export interface HomepageVersionInput {
  /** `import.meta.env.VITE_HOMEPAGE`, or whatever the caller reads. */
  envValue?: string | null;
  /** `location.search`, with or without the leading `?`. */
  search?: string | null;
}

/**
 * An unrecognised value is ignored rather than treated as an error: a typo in
 * an environment variable must not take the front door down, and falling
 * through to the next source is always safe.
 */
export function resolveHomepageVersion(input: HomepageVersionInput = {}): HomepageVersion {
  const search = input.search ?? '';
  let fromQuery: HomepageVersion | null = null;
  try {
    fromQuery = asVersion(new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get(HOMEPAGE_QUERY_PARAM));
  } catch {
    fromQuery = null;
  }
  return fromQuery ?? asVersion(input.envValue) ?? DEFAULT_HOMEPAGE_VERSION;
}
