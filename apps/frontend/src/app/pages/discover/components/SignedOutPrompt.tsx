import { useNavigate } from 'react-router-dom';
import type { Heart } from 'lucide-react';

import { C, FONT } from '../discoverTheme';
import { useDiscoverAuth } from '../DiscoverAuthContext';
import { PrimaryButton } from './DiscoverShell';

/**
 * What the authenticated tabs show to a signed-out visitor.
 *
 * Deliberately not a redirect to `/login`: browsing is public, and bouncing
 * someone out of Discover the moment they tap "Saved" loses the place they
 * were in. The tab explains what an account buys them and offers the way in,
 * with `returnTo` bringing them straight back.
 */
export function SignedOutPrompt({
  title,
  body,
  icon: Icon,
}: {
  title: string;
  body: string;
  icon: typeof Heart;
  /** @deprecated Sign-in is a modal now, so there is nothing to return from. */
  returnTo?: string;
}) {
  const navigate = useNavigate();
  const { openSignIn } = useDiscoverAuth();

  return (
    <div>
      <header
        className="border-b px-5 pb-4 pt-[max(3.25rem,env(safe-area-inset-top))]"
        style={{ background: C.cardWarm, borderColor: C.line }}
      >
        <h1 className="text-[24px] font-extrabold tracking-[-0.02em]" style={{ fontFamily: FONT.display, color: C.text }}>
          {title}
        </h1>
      </header>

      <div className="flex flex-col items-center px-8 pt-16 text-center">
        <span
          className="mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-full"
          style={{ background: '#F4EEE7' }}
        >
          <Icon className="h-8 w-8" strokeWidth={1.6} style={{ color: '#C9A98F' }} />
        </span>

        <h2 className="text-[18px] font-extrabold tracking-[-0.01em]" style={{ fontFamily: FONT.display, color: C.text }}>
          Your Stayo account
        </h2>
        <p className="mt-2 max-w-[19rem] text-[12.5px] leading-[1.6]" style={{ color: C.textMuted }}>
          {body}
        </p>

        <div className="mt-6 w-full max-w-[17rem]">
          <PrimaryButton full onClick={() => openSignIn()}>
            Sign in or create account
          </PrimaryButton>
        </div>

        <button
          type="button"
          onClick={() => navigate('/discover')}
          className="mt-3 px-2 py-2 text-[12.5px] font-semibold"
          style={{ color: C.textMuted }}
        >
          Keep browsing
        </button>
      </div>
    </div>
  );
}
