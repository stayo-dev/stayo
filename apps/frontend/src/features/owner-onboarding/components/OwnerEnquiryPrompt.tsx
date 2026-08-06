import { useEffect, useRef, useState } from 'react';
import {
  ENQUIRY_PROMPT_DISMISS_KEY,
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
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      const scrollFraction = scrollable > 0 ? window.scrollY / scrollable : 0;

      if (
        shouldShowEnquiryPrompt({
          scrollFraction,
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

    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
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
