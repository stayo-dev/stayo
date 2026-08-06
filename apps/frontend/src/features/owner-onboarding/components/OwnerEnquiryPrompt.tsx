import { useEffect, useRef, useState } from 'react';
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

/**
 * "Are you a hostel owner?" — appears once the visitor scrolls past the hero.
 *
 * Accepting calls straight into the landing page's existing owner entry
 * point, so there is exactly one lead-capture flow (Google → details → phone
 * OTP), not a second one duplicated here. All show/hide rules live in the
 * tested `enquiryPromptPolicy` module.
 */
export function OwnerEnquiryPrompt({ isOwnerWithHostel, onAccept }: OwnerEnquiryPromptProps) {
  const [visible, setVisible] = useState(false);
  const shownRef = useRef(false);

  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const body = document.body;

      if (
        shouldShowEnquiryPrompt({
          scrollFraction: computeScrollFraction({
            // Whichever of the three actually moves — see computeScrollFraction's
            // note on why documentElement alone is not enough here.
            scrollTop: window.scrollY || doc.scrollTop || body.scrollTop || 0,
            contentHeight: Math.max(doc.scrollHeight, body.scrollHeight),
            viewportHeight: window.innerHeight,
          }),
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

    // `<body>` is this app's scroll container (theme.css sets overflow-x:hidden
    // on html and body, which forces overflow-y to auto). Verified in a headless
    // browser against the live page: with body scrolling, a 'scroll' listener on
    // window fires 0 times and one on document fires 0 times — only the listener
    // on body fires. Binding all three keeps this correct if the layout ever
    // changes back to a document-scrolled page; the handler is idempotent, so
    // duplicate events are harmless.
    const targets: Array<EventTarget> = [window, document, document.body];
    targets.forEach((t) => t.addEventListener('scroll', onScroll, { passive: true }));

    // Fire once on mount: the visitor may already be part-way down the page on
    // a back-navigation or a #hash landing, where no scroll event ever arrives.
    onScroll();

    return () => targets.forEach((t) => t.removeEventListener('scroll', onScroll));
  }, [isOwnerWithHostel]);

  const dismiss = () => {
    setVisible(false);
    try {
      window.localStorage.setItem(ENQUIRY_PROMPT_DISMISS_KEY, String(Date.now()));
    } catch {
      // Storage unavailable — the session-level guard still stops it reappearing on this page view.
    }
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-label="Are you a hostel owner?"
      className="fixed inset-x-4 bottom-4 z-[120] mx-auto max-w-sm rounded-2xl border border-black/10 bg-white p-5 shadow-xl sm:right-6 sm:left-auto"
    >
      <h2 className="text-base font-semibold text-[#2B1B12]">Are you a hostel owner?</h2>
      <p className="mt-1.5 text-sm text-[#6B5B52]">
        Tell us about your property and we'll get you set up on Stayo.
      </p>
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => {
            dismiss();
            onAccept();
          }}
          className="flex-1 rounded-xl bg-[#2B1B12] px-4 py-2.5 text-sm font-medium text-white"
        >
          Yes, I am
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-xl border border-black/10 px-4 py-2.5 text-sm font-medium text-[#6B5B52]"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
