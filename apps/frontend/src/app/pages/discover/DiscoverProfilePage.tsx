import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, ClipboardList, Heart, History, Home, LifeBuoy, Luggage, ShieldCheck, User } from 'lucide-react';

import { useAuth } from '@context/AuthContext';
import { useEnquiries, useIsSeeker, useSavedHostels } from '@features/discover/hooks/useDiscover';
import {
  useDisclosures,
  useProfileIdentity,
  useResidencyHistory,
} from '@features/profile/hooks/useProfileIdentity';

import { SignedOutPrompt } from './components/SignedOutPrompt';
import { C, FONT } from './discoverTheme';

function initials(name: string | undefined): string {
  if (!name) return 'S';
  return name
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

export function DiscoverProfilePage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const { isSeeker, loading } = useIsSeeker();
  const { data: saved } = useSavedHostels();
  const { data: enquiries } = useEnquiries();
  const { data: identity } = useProfileIdentity();
  const { data: history } = useResidencyHistory();
  const { data: disclosures } = useDisclosures();

  const pendingCount = disclosures?.pending_requests.length ?? 0;

  useEffect(() => {
    document.title = 'Your Stayo account';
  }, []);

  if (!loading && !isSeeker) {
    return (
      <SignedOutPrompt
        title="Profile"
        icon={User}
        body="One Stayo account to search, save and enquire — and the same one you'll use to move in."
        returnTo="/discover/profile"
      />
    );
  }

  // A seeker who already lives somewhere gets a way back into their portal.
  const hasTenancy = Boolean(user?.tenant_id);

  return (
    <div>
      <header
        className="relative overflow-hidden rounded-b-[28px] px-5 pb-6 pt-[max(3.5rem,env(safe-area-inset-top))]"
        style={{ background: C.ink }}
      >
        <div
          className="pointer-events-none absolute -right-12 -top-8 h-40 w-40 rounded-full"
          style={{ background: 'radial-gradient(circle,rgba(217,144,111,.22),transparent 70%)' }}
        />
        <div className="relative flex items-center gap-3.5">
          <span
            className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl text-[19px] font-extrabold text-white"
            style={{ fontFamily: FONT.display, background: C.clay, boxShadow: '0 6px 16px rgba(180,106,85,.4)' }}
          >
            {initials(user?.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-[19px] font-extrabold tracking-[-0.01em] text-white"
              style={{ fontFamily: FONT.display }}
            >
              {user?.name ?? 'Your account'}
            </p>
            <p className="mt-0.5 truncate text-[12px]" style={{ color: '#A79C90' }}>
              {user?.email}
            </p>
          </div>
        </div>

        <div
          className="relative mt-5 flex overflow-hidden rounded-2xl"
          style={{ background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.07)' }}
        >
          <Stat value={enquiries?.length ?? 0} label="Enquiries" />
          <span className="my-3 w-px" style={{ background: 'rgba(255,255,255,.08)' }} />
          <Stat value={saved?.length ?? 0} label="Saved" />
        </div>
      </header>

      <div className="space-y-6 px-5 pb-10 pt-5">
        {/* Activity */}
        <section>
          <h2 className="mb-2.5 pl-0.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
            Your activity
          </h2>
          <div className="flex gap-2.5">
            <ActivityTile
              icon={Heart}
              count={saved?.length ?? 0}
              label="Saved hostels"
              tint="#FBEFE9"
              iconColor={C.clayLight}
              onClick={() => navigate('/discover/saved')}
            />
            <ActivityTile
              icon={ClipboardList}
              count={enquiries?.length ?? 0}
              label="Enquiries"
              tint="#F0E8DF"
              iconColor={C.textMuted}
              onClick={() => navigate('/discover/enquiries')}
            />
          </div>
        </section>

        {/* The portable profile — now real, so it describes what it does. */}
        <section
          className="relative overflow-hidden rounded-[18px] p-5"
          style={{
            background: 'linear-gradient(135deg,#2A2521,#3B322B)',
            boxShadow: '0 8px 22px rgba(34,30,26,.22)',
          }}
        >
          <div
            className="pointer-events-none absolute -bottom-9 -right-8 h-32 w-32 rounded-full"
            style={{ background: 'radial-gradient(circle,rgba(217,144,111,.28),transparent 70%)' }}
          />
          <div className="relative flex items-start gap-3">
            <span
              className="flex h-10 w-10 flex-none items-center justify-center rounded-xl"
              style={{ background: 'rgba(217,144,111,.18)' }}
            >
              <Luggage className="h-5 w-5" strokeWidth={1.7} style={{ color: C.clayPale }} />
            </span>
            <div className="min-w-0">
              <p className="text-[14.5px] font-extrabold tracking-[-0.01em] text-white" style={{ fontFamily: FONT.display }}>
                Your details travel with you
              </p>
              <p className="mt-1 text-[12px] leading-[1.5]" style={{ color: '#B6ABA0' }}>
                {identity?.is_complete
                  ? 'Filled in. Every hostel you join will open its onboarding with these already there.'
                  : 'Fill these in once — before you even enquire — and every hostel you join opens its onboarding already filled.'}
              </p>
            </div>
          </div>

          {/* Progress is stated only when we actually know it. */}
          {identity && !identity.is_complete && identity.missing_core_fields.length > 0 && (
            <p className="relative mt-3 text-[11.5px] font-semibold" style={{ color: C.clayPale }}>
              {identity.missing_core_fields.length} detail
              {identity.missing_core_fields.length === 1 ? '' : 's'} still needed
            </p>
          )}

          <button
            type="button"
            onClick={() => navigate('/discover/profile/details')}
            className="relative mt-3.5 w-full rounded-[11px] py-3 text-[13px] font-extrabold"
            style={{ fontFamily: FONT.display, background: C.clayLight, color: C.ink }}
          >
            {identity?.is_complete ? 'Review your details' : 'Complete your details'}
          </button>
        </section>

        {/* Stay history — with any pending request surfaced, since it needs an answer */}
        <section>
          <h2 className="mb-2.5 pl-0.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
            Your record
          </h2>
          <button
            type="button"
            onClick={() => navigate('/discover/profile/history')}
            className="flex w-full items-center gap-3.5 rounded-2xl border bg-white px-4 py-3.5 text-left"
            style={{ borderColor: pendingCount > 0 ? C.clay : C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}
          >
            <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px]" style={{ background: '#F4EEE7' }}>
              <History className="h-[17px] w-[17px]" strokeWidth={1.8} style={{ color: C.textMuted }} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold" style={{ color: C.inkSoft }}>
                Stay history
              </span>
              <span className="block truncate text-[11px]" style={{ color: C.textFaint }}>
                {history
                  ? `${history.total_stays} past stay${history.total_stays === 1 ? '' : 's'} · you choose who sees it`
                  : 'Where you’ve stayed, and who can see it'}
              </span>
            </span>
            {pendingCount > 0 && (
              <span
                className="flex-none rounded-full px-2.5 py-1 text-[10.5px] font-bold"
                style={{ background: C.clayPaleBg, color: '#A4482F' }}
              >
                {pendingCount} to answer
              </span>
            )}
            <ChevronRight className="h-4 w-4 flex-none" style={{ color: '#C9BFB4' }} />
          </button>
        </section>

        {/* Links */}
        <section>
          <h2 className="mb-2.5 pl-0.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
            Account
          </h2>
          <div
            className="overflow-hidden rounded-2xl border bg-white"
            style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}
          >
            {hasTenancy && (
              <Row
                icon={Home}
                title="Your hostel"
                sub="Rent, room, food and everything else"
                onClick={() => navigate('/tenant/home')}
                first
              />
            )}
            <Row
              icon={ShieldCheck}
              title="Safety & trust"
              sub="How Stayo verifies the hostels it lists"
              onClick={() => navigate('/about')}
              first={!hasTenancy}
            />
            <Row
              icon={LifeBuoy}
              title="Help & contact"
              sub="Questions about a hostel or your account"
              onClick={() => navigate('/contact')}
            />
          </div>
        </section>

        <button
          type="button"
          onClick={() => logout(true)}
          className="w-full py-2 text-center text-[13.5px] font-bold"
          style={{ fontFamily: FONT.display, color: '#B3402F' }}
        >
          Log out
        </button>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex-1 px-2.5 py-3.5 text-center">
      <p className="text-[19px] font-extrabold text-white" style={{ fontFamily: FONT.display }}>
        {value}
      </p>
      <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.04em]" style={{ color: '#8C8177' }}>
        {label}
      </p>
    </div>
  );
}

function ActivityTile({
  icon: Icon,
  count,
  label,
  tint,
  iconColor,
  onClick,
}: {
  icon: typeof Heart;
  count: number;
  label: string;
  tint: string;
  iconColor: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 rounded-2xl border bg-white p-3.5 text-left"
      style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04),0 6px 16px rgba(40,30,20,.05)' }}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-[10px]" style={{ background: tint }}>
        <Icon className="h-[17px] w-[17px]" strokeWidth={1.8} style={{ color: iconColor }} />
      </span>
      <span className="mt-2.5 block text-[20px] font-extrabold" style={{ fontFamily: FONT.display, color: C.text }}>
        {count}
      </span>
      <span className="block text-[11.5px]" style={{ color: C.textMuted }}>{label}</span>
    </button>
  );
}

function Row({
  icon: Icon,
  title,
  sub,
  onClick,
  first,
}: {
  icon: typeof Heart;
  title: string;
  sub: string;
  onClick: () => void;
  first?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3.5 px-4 py-3.5 text-left"
      style={{ borderTop: first ? 'none' : `1px solid ${C.lineSoft}` }}
    >
      <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px]" style={{ background: '#F4EEE7' }}>
        <Icon className="h-[17px] w-[17px]" strokeWidth={1.8} style={{ color: C.textMuted }} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13.5px] font-semibold" style={{ color: C.inkSoft }}>{title}</span>
        <span className="block truncate text-[11px]" style={{ color: C.textFaint }}>{sub}</span>
      </span>
      <ChevronRight className="h-4 w-4 flex-none" style={{ color: '#C9BFB4' }} />
    </button>
  );
}
