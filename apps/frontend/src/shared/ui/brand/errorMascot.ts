/**
 * Which face the Stayo dog wears when something has failed (ADR-209).
 *
 * The mascot's presence policy puts it at human moments — login, onboarding,
 * empty, error, 404, success — and explicitly never on a loader, because waits
 * belong to the four windows lighting up ("one gesture per wait").
 *
 * PURE — a lookup, kept out of the component so it can be tested under the
 * node-only suite and so the one rule below is stated in one place.
 */
import type { DogExpressionName } from './mascot';
import type { StayoErrorTone } from './StayoErrorScreen';

/**
 * Two faces, not five.
 *
 * A missing page is a question — the dog tilts its head and perks its ears
 * (`curious`). Everything that actually broke is a disappointment, not a
 * catastrophe: ears down, mouth wobbling (`concerned`). Severity is carried by
 * the copy and the badge icon, exactly as `StayoErrorScreen` already decided
 * for its own visuals; giving each tone its own expression would make a flaky
 * connection look like a different kind of emergency than a 500.
 *
 * `auth` deliberately does **not** use `covering`. Covering the eyes means one
 * specific thing in this product — the dog not watching you type a password —
 * and overloading it with "you are signed out" would spend that meaning.
 */
export function errorMascotExpression(tone: StayoErrorTone): DogExpressionName {
  return tone === 'notFound' ? 'curious' : 'concerned';
}

/**
 * Whether the dog appears at all, given the surface it is on.
 *
 * `screen` is a whole-surface failure — a route that would otherwise be blank,
 * which is where a companion earns its place. `inset` is one card or section
 * that failed while the rest of the page still works; a mascot there competes
 * with the working content around it.
 *
 * It also keeps the dog off the money screens without anyone having to
 * remember to: payment surfaces report failures through `ErrorCard`, which has
 * no mascot at all, and their section-level failures are `inset`.
 */
export function showsErrorMascot(variant: 'screen' | 'inset', explicit?: boolean): boolean {
  return explicit ?? variant === 'screen';
}
