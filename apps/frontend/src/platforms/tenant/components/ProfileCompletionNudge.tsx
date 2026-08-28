import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useProfileIdentity } from '@features/profile/hooks/useProfileIdentity';

const card = 'rounded-[16px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_4px_14px_rgba(40,30,20,0.05)]';

/**
 * "Complete your profile · X% · Continue →" — shown on the Dashboard's Home
 * tab for a tenant whose common Stayo profile isn't 100% complete yet.
 * Informational only: Dashboard entry itself is never gated on this (see
 * `ProtectedTenantRoute`, which dropped the old `is_profile_completed`
 * hard-block). Reads the same `completion_percent` the Explore/Profile
 * nudge card does (`useProfileIdentity()`, one query key, one number) —
 * not a second computation.
 *
 * Opens the profile **section** (`/profile`), not the edit form beneath it —
 * "complete your profile" should show the tenant their profile, with what is
 * missing visible, rather than dropping them straight into one form.
 *
 * Carries `returnTo`, because `/profile/*` renders outside the tenant app
 * shell: it has no bottom nav and its hub has no back button, so a tenant sent
 * there from the Dashboard previously had no route back at all.
 */
export function ProfileCompletionNudge() {
  const navigate = useNavigate();
  const { data: identity, isLoading } = useProfileIdentity();

  if (isLoading || !identity || identity.completion_percent >= 100) return null;

  return (
    <button
      type="button"
      onClick={() => navigate('/profile', { state: { returnTo: '/tenant/home' } })}
      className={`${card} p-[18px] text-left`}
    >
      <div className="flex items-center justify-between">
        <span className="font-display text-[14.5px] font-extrabold tracking-[-0.01em] text-foreground">Complete your profile</span>
        <span className="font-display text-[13px] font-extrabold text-primary">{identity.completion_percent}%</span>
      </div>
      <div className="mt-2.5 h-[7px] overflow-hidden rounded-full bg-[#F0E7DC]">
        <div
          className="h-full rounded-full"
          style={{ width: `${identity.completion_percent}%`, background: 'linear-gradient(90deg, #A85C48, #E0A57F)' }}
        />
      </div>
      <div className="mt-2.5 flex items-center justify-between">
        <span className="text-[12px] font-medium text-muted-foreground">Finish the remaining details to complete your Stayo setup.</span>
        <span className="flex flex-none items-center gap-0.5 font-display text-[12.5px] font-bold text-primary">
          Continue <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
  );
}
