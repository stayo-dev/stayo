import { useEffect, useRef, useState } from 'react';
import { BadgeCheck, X } from 'lucide-react';
import { readScrollGeometry, subscribeToScroll } from '@shared/lib/scroll';
import {
  ENQUIRY_PROMPT_DISMISS_KEY,
  computeScrollFraction,
  shouldShowEnquiryPrompt,
} from '../enquiryPromptPolicy';

type OwnerEnquiryPromptProps = {
  isOwnerWithHostel: boolean;
  onAccept: () => void;
};

function readDismissedAt(): number | null {
  try {
    const raw = window.localStorage.getItem(ENQUIRY_PROMPT_DISMISS_KEY);
    return raw === null ? null : Number(raw);
  } catch {
    // Private-mode or blocked storage — treat as never dismissed rather than crashing.
    return null;
  }
}

function rememberDismissal() {
  try {
    window.localStorage.setItem(ENQUIRY_PROMPT_DISMISS_KEY, String(Date.now()));
  } catch {
    // Storage unavailable — the session-level guard still stops it reappearing on this page view.
  }
}

/**
 * "Are you a hostel owner?" — slides in once the visitor scrolls past the hero.
 *
 * Accepting calls straight into the landing page's existing owner entry point,
 * so there is exactly one lead-capture flow (Google → details → phone OTP),
 * not a second one duplicated here. All show/hide rules live in the tested
 * `enquiryPromptPolicy` module; scroll measurement lives in `@shared/lib/scroll`
 * because `<body>` — not the document — is this app's scroll container.
 */
export function OwnerEnquiryPrompt({ isOwnerWithHostel, onAccept }: OwnerEnquiryPromptProps) {
  const [visible, setVisible] = useState(false);
  const shownRef = useRef(false);

  useEffect(() => {
    const evaluate = () => {
      if (
        shouldShowEnquiryPrompt({
          scrollFraction: computeScrollFraction(readScrollGeometry()),
          dismissedAt: readDismissedAt(),
          isOwnerWithHostel,
          alreadyShownThisSession: shownRef.current,
          now: Date.now(),
        })
      ) {
        shownRef.current = true;
        setVisible(true);
      }
    };

    return subscribeToScroll(evaluate);
  }, [isOwnerWithHostel]);

  // Escape closes it, like any other dismissible overlay.
  useEffect(() => {
    if (!visible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') decline();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  /** Explicit "no" — suppressed for the full cooldown. */
  const decline = () => {
    setVisible(false);
    rememberDismissal();
  };

  /**
   * Interested. Deliberately does NOT write the cooldown: someone who clicks
   * through and then abandons the Google step should still be re-prompted on a
   * later visit, rather than being locked out for a week. `shownRef` still
   * stops it reappearing during this page view.
   */
  const accept = () => {
    setVisible(false);
    onAccept();
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="owner-enquiry-prompt-title"
      className="stayo-enquiry-prompt fixed inset-x-3 bottom-3 z-[400] mx-auto max-w-[420px] sm:inset-x-auto sm:right-6 sm:bottom-6 sm:mx-0"
    >
      <div className="relative overflow-hidden rounded-[20px] border border-border bg-card p-5 shadow-[0_28px_60px_-20px_rgba(47,47,47,0.45)]">
        {/* Warm accent wash so the card reads as Stayo, not a generic toast. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -right-12 -top-14 h-36 w-36 rounded-full bg-accent/25 blur-2xl"
        />

        <button
          type="button"
          onClick={decline}
          aria-label="Dismiss"
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>

        <div className="relative flex items-start gap-3">
          <span className="stayo-enquiry-prompt-badge flex h-10 w-10 flex-none items-center justify-center rounded-[12px] bg-primary/10 text-primary">
            <BadgeCheck className="h-5 w-5" strokeWidth={2.4} />
          </span>
          <div className="min-w-0 pr-6">
            <h2
              id="owner-enquiry-prompt-title"
              className="font-display text-[17px] font-extrabold leading-tight text-foreground"
            >
              Are you a hostel owner?
            </h2>
            <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">
              Get verified and start managing rent, rooms and tenants on Stayo — setup takes under a day.
            </p>
          </div>
        </div>

        <div className="relative mt-4 flex items-center gap-2.5">
          <button
            type="button"
            onClick={accept}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 font-display text-sm font-bold text-primary-foreground shadow-[0_10px_22px_-10px_rgba(164,93,68,0.7)] transition-transform hover:scale-[1.02]"
          >
            Yes — get me set up
          </button>
          <button
            type="button"
            onClick={decline}
            className="rounded-xl px-3 py-2.5 text-[13px] font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
