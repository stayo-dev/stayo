import { useMemo, useEffect, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronRight,
  ClipboardList,
  FileText,
  GraduationCap,
  Heart,
  History,
  Home,
  LifeBuoy,
  Lock,
  LogOut,
  Luggage,
  Phone,
  ShieldAlert,
  ShieldCheck,
  User,
} from 'lucide-react';

import { useAuth } from '@context/AuthContext';
import { hasLiveTenancy } from '@/app/nav/useAppNav';
import { useEnquiries, useIsSeeker, useSavedHostels } from '@features/discover/hooks/useDiscover';
import { useTenantProfile } from '@features/tenant-profile/hooks/useTenantProfile';
import { useOverlayStack } from '@/platforms/tenant/components/overlays/useOverlayStack';
import { ProfileEditScreen } from '@/platforms/tenant/components/overlays/ProfileEditScreen';
import { buildProfileEditConfigs } from '@/platforms/tenant/components/overlays/configs/profileEditConfigs';
import { stayoToast } from '@shared/ui-patterns/Toast';
import {
  useDisclosures,
  useProfileIdentity,
  useResidencyHistory,
} from '@features/profile/hooks/useProfileIdentity';

import { SignedOutPrompt } from './components/SignedOutPrompt';
import { C, FONT } from './discoverTheme';
import { countMeta, gapHint, heroMode, stayMeta, totalGaps } from '@features/profile-hub/profileHub';
import { ListGroup, ListRowItem, SectionHead } from '@features/stayo-ui/ListSection';
import { currentStay, historySummaryLine, stayDuration, stayLine } from '@features/tenant-room/staySummary';
import { MoveOutSheet } from '@features/tenant-room/components/MoveOutSheet';
import { CloseAccountSheet } from '@features/account-closure/components/CloseAccountSheet';


/**
 * The tenancy-scoped detail groups a live-tenancy user edits here (governed
 * phone/email routed through owner-approval by `buildProfileEditConfigs` —
 * see `GOVERNED_PROFILE_FIELDS`). Carried over from the old
 * `TenantProfilePage`, which this hub absorbed — same data source
 * (`useTenantProfile()`, per-tenancy), deliberately distinct from the
 * portable `profile_identity` fields in the "Your details travel with you"
 * card above, which stay directly editable regardless of tenancy.
 */
const TENANCY_DETAIL_GROUPS = [
  { key: 'personal_info', title: 'Personal information', icon: User },
  { key: 'contact_info', title: 'Contact details', icon: Phone },
  { key: 'emergency_info', title: 'Emergency contact', icon: ShieldAlert },
  { key: 'academic_info', title: 'Academic details', icon: GraduationCap },
];

const DETAIL_KEYS = TENANCY_DETAIL_GROUPS.map((group) => group.key);

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
  const stay = useMemo(() => currentStay(history), [history]);
  const [moveOutOpen, setMoveOutOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const { data: disclosures } = useDisclosures();
  const liveTenancy = hasLiveTenancy(user);
  const tenantProfile = useTenantProfile();
  const overlay = useOverlayStack();

  const editConfigs = useMemo(
    () => buildProfileEditConfigs(tenantProfile.tenant, tenantProfile.profile, tenantProfile.contacts, tenantProfile.documents, tenantProfile.verification),
    [tenantProfile.tenant, tenantProfile.profile, tenantProfile.contacts, tenantProfile.documents, tenantProfile.verification],
  );

  const pendingCount = disclosures?.pending_requests.length ?? 0;

  /** The three records every "what's missing" answer is read from. */
  const detailSources = useMemo(
    () => ({ tenant: tenantProfile.tenant, profile: tenantProfile.profile, contacts: tenantProfile.contacts }),
    [tenantProfile.tenant, tenantProfile.profile, tenantProfile.contacts],
  );
  const gaps = liveTenancy ? totalGaps(DETAIL_KEYS, detailSources) : 0;
  const hero = heroMode({ hasLiveStay: Boolean(stay), identityComplete: identity?.is_complete ?? null });
  /** `total_stays` counts the ones they left; the current stay is one more. */
  const totalStays = (history?.total_stays ?? 0) + (stay ? 1 : 0);

  useEffect(() => {
    document.title = 'Your Stayo account';
  }, []);

  /** Opens a native file picker for a given document type and uploads it — used by Personal information's Aadhaar row, which re-routes to the document flow instead of a text input. Carried over from `TenantProfilePage`. */
  const triggerDocumentUpload = (docType: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,application/pdf';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      tenantProfile
        .uploadDocument({ docType, file })
        .then(() => stayoToast.success('Document uploaded'))
        .catch((err: any) => stayoToast.error(err?.response?.data?.error?.message || 'Could not upload — please try again'));
    };
    input.click();
  };

  if (!loading && !isSeeker) {
    return (
      <SignedOutPrompt
        title="Profile"
        icon={User}
        body="One Stayo account to search, save and enquire — and the same one you'll use to move in."
        returnTo="/profile"
      />
    );
  }

  return (
    <div>
      {/*
        Minimal by decision.

        This was a dark slab with a radial glow and a translucent stat strip —
        a lot of chrome to say a name and two numbers, on the one screen where
        a person is looking for their own details. It sits on the app's paper
        ground now, with the terracotta monogram carrying the brand instead of
        a block of ink, and the two counts as plain figures rather than a card
        inside a header. Sticky, so the person's identity stays put while their
        details scroll.
      */}
      <header
        className="sticky top-0 z-20 px-5 pb-3.5 pt-[max(2.5rem,env(safe-area-inset-top))] backdrop-blur-md"
        style={{ background: 'rgba(247,243,239,.88)', borderBottom: `1px solid ${C.line}` }}
      >
        <div className="flex items-center gap-3.5">
          <span
            className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl text-[19px] font-extrabold"
            style={{ fontFamily: FONT.display, background: C.clayPaleBg, color: C.clayDeep }}
          >
            {initials(user?.name)}
          </span>
          <div className="min-w-0 flex-1">
            <p
              className="truncate text-[19px] font-extrabold tracking-[-0.01em]"
              style={{ fontFamily: FONT.display, color: C.text }}
            >
              {user?.name ?? 'Your account'}
            </p>
            <p className="mt-0.5 truncate text-[12px]" style={{ color: C.textMuted }}>
              {user?.email}
            </p>
          </div>
          </div>
      </header>

      <div className="space-y-5 px-5 pb-10 pt-4">
        {/*
          ONE hero, chosen by `heroMode`. The page used to stack the portable-
          profile pitch on top of the card naming the room someone already
          lives in — 200px of the app arguing for something already accepted.
        */}
        {hero === 'stay' && stay && (
          <section
            className="rounded-[18px] border bg-white px-4 py-4"
            style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}
          >
            <div className="flex items-start gap-3">
              <span
                className="flex h-10 w-10 flex-none items-center justify-center rounded-xl"
                style={{ background: C.clayPaleBg, color: C.clay }}
              >
                <Home className="h-5 w-5" strokeWidth={1.8} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em]" style={{ color: C.textGhost }}>
                  Where you live
                </div>
                <div className="mt-0.5 truncate text-[15px] font-extrabold" style={{ fontFamily: FONT.display, color: C.text }}>
                  {stay.hostel_name ?? 'Your hostel'}
                </div>
                <div className="mt-0.5 text-[12px]" style={{ color: C.textFaint }}>
                  {[stayLine(stay), stayDuration(stay)].filter(Boolean).join(' · ')}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMoveOutOpen(true)}
              className="mt-3 w-full rounded-xl border py-2.5 text-[12.5px] font-semibold"
              style={{ borderColor: C.line, color: '#9A8F84' }}
            >
              Request to move out
            </button>
          </section>
        )}

        {hero === 'portable' && (
          <section
            className="relative overflow-hidden rounded-[18px] p-4"
            style={{ background: 'linear-gradient(135deg,#2A2521,#3B322B)', boxShadow: '0 8px 22px rgba(34,30,26,.22)' }}
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
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-extrabold tracking-[-0.01em] text-white" style={{ fontFamily: FONT.display }}>
                  Your details travel with you
                </p>
                <p className="mt-1 text-[11.5px] leading-[1.5]" style={{ color: '#B6ABA0' }}>
                  Fill these in once and every hostel you join opens its onboarding already filled.
                </p>
              </div>
              {identity && (
                <span className="flex-none font-display text-[13px] font-extrabold" style={{ color: C.clayPale }}>
                  {identity.completion_percent}%
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => navigate('/profile/details')}
              className="relative mt-3 w-full rounded-[11px] py-2.5 text-[12.5px] font-extrabold"
              style={{ fontFamily: FONT.display, background: C.clayLight, color: C.ink }}
            >
              Complete your details
            </button>
          </section>
        )}

        {/*
          Details as rows, not preview cards.

          Each card used to print two key-value pairs — someone's own name, own
          birthday, and two em-dashes where a college would be. The value is
          one tap away and they already know it; what they cannot know without
          looking is what is still *missing*, so that is the only thing on the
          right. See `profileHub.ts`.
        */}
        {liveTenancy && (
          <section>
            <SectionHead
              title="Your details"
              meta={gaps > 0 ? `${gaps} to add` : 'All filled'}
              tone={gaps > 0 ? 'warn' : 'calm'}
            />
            <ListGroup>
              {TENANCY_DETAIL_GROUPS.map((group, index) => (
                <ListRowItem
                  key={group.key}
                  icon={group.icon}
                  title={group.title}
                  meta={gapHint(group.key, detailSources)}
                  metaTone="warn"
                  first={index === 0}
                  onClick={() => overlay.push(group.key)}
                />
              ))}
            </ListGroup>
          </section>
        )}

        {/* Everything attached to the account, under one heading instead of four. */}
        <section>
          <SectionHead title="Your record" />
          <ListGroup>
            <ListRowItem
              icon={FileText}
              title="Documents"
              meta={liveTenancy && tenantProfile.missingDocuments.length > 0 ? `${tenantProfile.missingDocuments.length} pending` : null}
              metaTone="warn"
              first
              onClick={() => navigate('/profile/documents')}
            />
            <ListRowItem
              icon={History}
              title="Stay history"
              meta={pendingCount > 0 ? `${pendingCount} to answer` : stayMeta(totalStays)}
              metaTone={pendingCount > 0 ? 'warn' : 'quiet'}
              onClick={() => navigate('/profile/history')}
            />
            <ListRowItem
              icon={Heart}
              title="Saved hostels"
              meta={countMeta(saved?.length)}
              metaTone="quiet"
              onClick={() => navigate('/profile/saved')}
            />
            <ListRowItem
              icon={ClipboardList}
              title="Enquiries"
              meta={countMeta(enquiries?.length)}
              metaTone="quiet"
              onClick={() => navigate('/profile/enquiries')}
            />
          </ListGroup>
        </section>

        {/*
          One Help, not three. This page carried "Help" (the Help Centre),
          "Help & contact" (the public marketing page) and "Help & support"
          (the hostel chat) in three separate sections. The hostel channel
          belongs on Room, where the complaint is; the marketing page is not
          somewhere a signed-in resident should be sent for help.
        */}
        <section>
          <SectionHead title="Stayo" />
          <ListGroup>
            <ListRowItem
              icon={LifeBuoy}
              title="Help"
              sub="Answers, or report a problem to Stayo"
              first
              onClick={() => navigate('/profile/tickets')}
            />
            <ListRowItem
              icon={ShieldCheck}
              title="Safety & trust"
              sub="How Stayo verifies the hostels it lists"
              onClick={() => navigate('/about')}
            />
          </ListGroup>
        </section>

        {/*
          Notifications, Language and Privacy & security used to sit here and
          every one of them raised "coming soon" — no preferences screen and no
          password-change screen exists in the app. Furniture that does nothing
          is worse than an absence, so they are gone until they are real.
        */}
        <div className="flex flex-col items-center gap-1 pt-1">
          <button
            type="button"
            onClick={() => logout(true)}
            className="flex w-full items-center justify-center gap-2 py-2 text-center text-[13.5px] font-bold"
            style={{ fontFamily: FONT.display, color: '#B3402F' }}
          >
            <LogOut className="h-4 w-4" /> Log out
          </button>
          {/*
            Quiet, but never hidden. Burying this is the dark-pattern version of
            "make them think twice"; the thinking happens inside the flow, where
            it is made of information rather than of a search for the button.
          */}
          <button
            type="button"
            onClick={() => setCloseOpen(true)}
            className="py-1.5 text-[12px] font-semibold underline"
            style={{ color: C.textGhost }}
          >
            Close my account
          </button>
        </div>
      </div>

      {/*
        Lives here, at the page root. It previously sat inside `Stat` — a
        component nothing ever rendered — so the button above set state that
        opened nothing at all. `vite build` uses esbuild and does not
        typecheck, so the out-of-scope references never failed a build.
      */}
      <CloseAccountSheet
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        context={{
          hasLiveTenancy: Boolean(liveTenancy),
          outstandingPaise: 0,
          moveOutPending: false,
          hostelName: stay?.hostel_name ?? null,
        }}
        losses={{
          stays: totalStays,
          months: history?.total_months ?? 0,
          savedHostels: saved?.length ?? 0,
          documents: tenantProfile.documents?.length ?? 0,
          enquiries: enquiries?.length ?? 0,
        }}
      />

      <MoveOutSheet
        open={moveOutOpen}
        onClose={() => setMoveOutOpen(false)}
        roomNo={stay?.room_no ?? null}
        hostelName={stay?.hostel_name ?? null}
      />

      {!overlay.isHome && editConfigs[overlay.view] && (
        <ProfileEditScreen
          title={editConfigs[overlay.view].title}
          sub={editConfigs[overlay.view].sub}
          viewSections={editConfigs[overlay.view].viewSections}
          headPill={editConfigs[overlay.view].headPill}
          pillTone={editConfigs[overlay.view].pillTone}
          editButtonLabel={editConfigs[overlay.view].editButtonLabel}
          sections={editConfigs[overlay.view].sections}
          isSaving={tenantProfile.isUpdating}
          onBack={overlay.back}
          onSaveDirect={async (patch) => {
            try {
              await tenantProfile.updateProfile(patch);
              stayoToast.success('Saved');
            } catch (err: any) {
              stayoToast.error(err?.response?.data?.error?.message || 'Could not save — please try again');
              throw err;
            }
          }}
          onUploadDocument={triggerDocumentUpload}
        />
      )}
    </div>
  );
}
