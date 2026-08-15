/**
 * The welcome chime on `/`, played as the splash begins.
 *
 * ── The one thing to know before changing this ────────────────────────────
 *
 * **Browsers block autoplay with sound**, and the splash runs on page load
 * with no prior user gesture, so `play()` is rejected outright for a
 * first-time visitor. This is not a bug to fix in code — it is the autoplay
 * policy working as designed, and no amount of retrying defeats it.
 *
 * What actually happens in practice:
 *   - a **returning** visitor usually hears it. Chrome keeps a Media
 *     Engagement Index per origin, and once someone has played media on the
 *     site a few times autoplay is permitted;
 *   - a **first-time** visitor usually does not, and gets silence.
 *
 * A rejected play is therefore swallowed, deliberately. The alternative —
 * queuing the chime until the visitor's first click — would fire a "welcome"
 * three seconds late, over a screen they are already reading, which is worse
 * than silence. If the chime must be guaranteed, it has to move behind a
 * gesture (the way the onboarding flow's ambient audio does, per ADR-072),
 * and that is a product decision, not a technical one.
 *
 * ── The rest ──────────────────────────────────────────────────────────────
 *
 * It plays only when the splash plays — once per browser session, keyed off
 * the same `sessionStorage` flag — so a visitor bouncing between `/` and
 * `/owners` does not hear it repeatedly. Volume is well under unity because
 * this is a flourish behind a brand mark, not a notification.
 */

const CHIME_SRC = '/stayo-welcome.mp3';

/** Loud enough to register at the same moment the mark lands, quiet enough not to startle. */
const VOLUME = 0.35;

/**
 * Starts the chime. Returns a cleanup that stops it — call it on unmount, so
 * the sound cannot bleed into `/owners` or `/discover` when the visitor picks
 * a side while it is still playing.
 */
export function playWelcomeChime(): () => void {
  // Sound is stimulation, not motion, but someone who has asked the system to
  // calm things down has not asked for an unprompted noise either. The splash
  // itself is skipped under this setting, so the chime would have nothing to
  // accompany regardless.
  if (typeof window === 'undefined') return () => {};
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return () => {};

  let audio: HTMLAudioElement | null = null;

  try {
    audio = new Audio(CHIME_SRC);
    audio.volume = VOLUME;
    audio.preload = 'auto';

    // `play()` rejects on a blocked autoplay, on a decode failure, and if the
    // element is torn down mid-load. None of those are worth surfacing on a
    // marketing screen — the page is fully usable in silence.
    void audio.play().catch(() => undefined);
  } catch {
    // Constructing Audio can throw in exotic/embedded environments.
    audio = null;
  }

  return () => {
    if (!audio) return;
    audio.pause();
    // Releases the decoder and any buffered data rather than leaving a paused
    // element attached to a dead component.
    audio.src = '';
    audio = null;
  };
}
