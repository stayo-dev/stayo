import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';

import { StayoMark } from '@shared/ui/brand';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';

import { ownerDoor } from '../home/homeHeader';

interface PublicHeaderProps {
  /**
   * Opens sign-in in place. When absent the header falls back to `/login`,
   * which is still the right door for a redirect that needs a real URL.
   */
  onSignIn?: () => void;
}

/**
 * The public site's one header.
 *
 * The owner door is a real, visible control at every width — not a hamburger
 * item. Owners are the paying side of this marketplace and must never have to
 * hunt for their entrance; they are simply not half the page, because they are
 * not half the traffic. "Log in" is visible at every width too: `LandingPage`
 * already shipped the bug where leaving login out of the mobile menu made
 * signing in impossible on a phone.
 */
export function PublicHeader({ onSignIn }: PublicHeaderProps = {}) {
  const session = useOwnerSession();
  const door = ownerDoor({
    isLoading: session.isLoading,
    isAuthenticated: session.isAuthenticated,
    hostelCount: session.hostels.length,
  });

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/92 backdrop-blur-lg">
      <div className="mx-auto flex h-[68px] max-w-6xl items-center gap-3 px-4 sm:h-[76px] sm:gap-8 sm:px-6">
        <Link to="/" className="flex flex-none items-center gap-2.5" aria-label="Stayo home">
          <StayoMark className="h-7 w-auto text-primary" />
          <span className="font-display text-xl font-extrabold tracking-tight text-foreground">Stayo</span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          <Link to="/discover" className="text-sm font-semibold text-foreground/80 hover:text-primary">
            Browse hostels
          </Link>
          <a href="#how" className="text-sm font-semibold text-foreground/80 hover:text-primary">
            How it works
          </a>
        </nav>

        <div className="flex-1" />

        {/* In place, not at `/login` — that URL renders the OWNER marketing
            page with the modal over it, which is exactly the dead end ADR-035's
            amendment fixed for Discover: a student who wants to sign in should
            not land on a pitch about occupancy dashboards. Same component,
            opened here. */}
        {onSignIn ? (
          <button
            type="button"
            onClick={onSignIn}
            className="inline-flex h-11 flex-none items-center px-2 text-[13.5px] font-semibold text-foreground/80 hover:text-primary sm:px-3 sm:text-sm"
          >
            Log in
          </button>
        ) : (
          <Link
            to="/login"
            className="inline-flex h-11 flex-none items-center px-2 text-[13.5px] font-semibold text-foreground/80 hover:text-primary sm:px-3 sm:text-sm"
          >
            Log in
          </Link>
        )}

        <Link
          to={door.to}
          state={door.declaresOwnerIntent ? { declaredOwnerIntent: true } : undefined}
          className="inline-flex h-11 flex-none items-center gap-2 rounded-xl border border-border bg-card px-3 font-display text-[12.5px] font-bold text-foreground hover:border-primary/40 sm:px-4 sm:text-sm"
        >
          <Building2 className="hidden h-4 w-4 text-primary sm:block" strokeWidth={2} aria-hidden="true" />
          {door.label}
        </Link>
      </div>
    </header>
  );
}
