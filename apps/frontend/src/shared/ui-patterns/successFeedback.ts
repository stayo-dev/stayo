/**
 * The Stayo success confirmation — a sound and a haptic — fired when an owner
 * completes something that involves money, a commitment, or another person.
 *
 * ── Where this plays, and where it deliberately does not ──────────────────
 *
 * It is wired to the five owner flows that have a **dedicated success
 * screen** — recording a payment, collecting a payment, adding an expense,
 * changing a tenant's rent, and inviting a tenant. Those are the moments
 * where the owner has committed to something and needs telling, plainly,
 * that it landed.
 *
 * It is deliberately **not** attached to `stayoToast.success`. That has 57
 * call sites and most are housekeeping — "Saved", "Link copied", "Logo
 * removed" — and per its own doc comment it also carries "coming soon"
 * placeholders. A sound that fires on copying a link is not a confirmation,
 * it is noise, and it would devalue the sound in the five places it matters.
 *
 * ── Sound and haptic are one call, deliberately ───────────────────────────
 *
 * `playSuccessFeedback()` does both. The alternative — exporting them
 * separately and calling both at each of the five sites — is two calls to
 * remember in a place that is easy to forget, and the sixth flow added later
 * would sooner or later get one and not the other. They are one confirmation
 * and they leave through one door.
 *
 * The haptic is not a duplicate of the sound: it is what still works when the
 * owner's phone is on silent, which is precisely when the sound does not.
 *
 * ── Autoplay is not a problem here ────────────────────────────────────────
 *
 * `welcomeChime.ts` carries a long warning about browsers blocking playback:
 * it fires on page load with no prior gesture, so a first-time visitor
 * simply gets silence. **That does not apply to this sound.** Every one of
 * these five plays follows the owner tapping a confirm button, which is a
 * real user gesture, so the autoplay policy permits it.
 *
 * Chrome applies the same user-activation requirement to `navigator.vibrate`,
 * so the haptic works for exactly the same reason the sound does.
 *
 * That is also why this does *not* bail out under `prefers-reduced-motion`,
 * where the chime does. The chime's reasoning is that someone who asked the
 * system to calm down did not ask for an *unprompted* noise — but this sound
 * is prompted, it is the direct answer to a button the owner just pressed,
 * and reduced-motion is a preference about motion rather than sound.
 * Silencing it there would remove the confirmation from exactly the people
 * most likely to be relying on non-visual feedback. The haptic is left
 * ungated on the same reasoning — that query is about visual animation and
 * vestibular triggers, and this buzz is the answer to a button just pressed.
 */

export const SUCCESS_SOUND_SRC = '/stayo-success.mp3';

/**
 * Above `welcomeChime`'s 0.35. That is a flourish behind a brand mark; this
 * is a confirmation that money moved, and has to register as one.
 */
export const SUCCESS_SOUND_VOLUME = 0.45;

/** The slice of `HTMLAudioElement` this needs — kept narrow so it can be faked in a node test. */
export interface SoundElement {
  volume: number;
  currentTime: number;
  play(): Promise<void> | void;
}

/**
 * Builds a play function over one lazily-created element.
 *
 * **One element, reused.** The file is fetched and decoded once rather than
 * on every confirmation, and a re-trigger seeks back to zero instead of
 * layering a second copy over the first. An owner collecting rent from
 * tenants back-to-back hears the sound every time — that is the intended
 * behaviour — but never two of it at once, which is cacophony rather than
 * confirmation.
 *
 * **Nothing in here may throw.** It runs immediately after a payment has
 * been recorded, on a screen whose entire job is to reassure. A missing
 * decoder, a blocked play, or an environment with no `Audio` at all must
 * cost the owner silence and nothing else.
 */
export function createSoundPlayer(make: () => SoundElement): () => void {
  let element: SoundElement | null = null;

  return () => {
    try {
      if (!element) {
        element = make();
        element.volume = SUCCESS_SOUND_VOLUME;
      }
      element.currentTime = 0;
      const started = element.play();
      // `play()` returns a promise in every current browser and `undefined`
      // in older ones. A rejection here is routine, not exceptional.
      if (started && typeof (started as Promise<void>).catch === 'function') {
        (started as Promise<void>).catch(() => undefined);
      }
    } catch {
      // Drop the element so a transient failure doesn't disable the sound
      // for the rest of the session.
      element = null;
    }
  };
}

/**
 * Deliberately **not exported.** A caller reaching for sound alone is the
 * drift this module exists to prevent — `playSuccessFeedback` is the door.
 */
const playSuccessSound = createSoundPlayer(() => {
  if (typeof window === 'undefined' || typeof Audio === 'undefined') {
    throw new Error('No audio in this environment');
  }
  const audio = new Audio(SUCCESS_SOUND_SRC);
  audio.preload = 'auto';
  return audio;
});


// ── Haptic ─────────────────────────────────────────────────────────────────

/**
 * Two short pulses with a gap — buzz, pause, buzz.
 *
 * A single tick is what every notification on the phone already uses and
 * carries no meaning of its own; a longer single buzz reads as the error
 * pattern most Android apps use, which is the opposite of reassurance. Two
 * pulses read as "confirmed" and pair with the chime without outlasting it.
 */
export const SUCCESS_VIBRATION = [20, 45, 20];

export type VibrateFn = (pattern: number | number[]) => boolean;

/**
 * Builds the haptic trigger over a lookup that returns the platform's
 * `vibrate`, or `null` where there isn't one.
 *
 * **There is no haptic on iOS.** Safari does not implement the Vibration API
 * at all — `navigator.vibrate` is simply absent, and no web workaround
 * exists — so every iPhone owner gets the sound and nothing else. That is a
 * silent no-op by design, not a failure to handle.
 *
 * The lookup itself is allowed to throw: reading `navigator` raises a
 * SecurityError inside some cross-origin frames. As with the sound, nothing
 * here may surface on a screen whose job is to confirm that money moved.
 */
export function createHapticPlayer(getVibrate: () => VibrateFn | null): () => void {
  return () => {
    try {
      const vibrate = getVibrate();
      if (!vibrate) return;
      vibrate(SUCCESS_VIBRATION);
    } catch {
      // A phone that will not buzz is not a problem worth reporting.
    }
  };
}

const playSuccessHaptic = createHapticPlayer(() =>
  typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
    ? navigator.vibrate.bind(navigator)
    : null,
);

/**
 * The one call the five owner success screens make. Fire-and-forget — no
 * caller awaits it, and no caller handles its failure, because it has none.
 *
 * Haptic first: it is synchronous and instant, so it lands with the tap
 * rather than behind whatever the audio element is doing.
 */
export function playSuccessFeedback(): void {
  playSuccessHaptic();
  playSuccessSound();
}
