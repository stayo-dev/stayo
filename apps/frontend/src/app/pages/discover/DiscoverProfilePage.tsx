import { useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronRight,
  ClipboardList,
  FileText,
  GraduationCap,
  Globe,
  Heart,
  History,
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

const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const dateLabel = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

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
  {
    key: 'personal_info',
    title: 'Personal information',
    icon: User,
    preview: (t: any, p: any) => [
      { k: 'Full name', v: dash(p?.name) },
      { k: 'Date of birth', v: dateLabel(t?.date_of_birth) },
    ],
  },
  {
    key: 'contact_info',
    title: 'Contact details',
    icon: Phone,
    preview: (t: any, p: any, c: any) => [
      { k: 'Phone', v: dash(c?.tenant_phone?.value ?? p?.phone) },
      { k: 'Email', v: dash(p?.email ?? p?.account_email) },
    ],
  },
  {
    key: 'emergency_info',
    title: 'Emergency contact',
    icon: ShieldAlert,
    preview: (t: any, p: any, c: any) => [
      { k: 'Guardian', v: dash(t?.guardian_name) },
      { k: 'Phone', v: dash(c?.guardian_phone?.value ?? t?.guardian_phone ?? t?.phone_2) },
    ],
  },
  {
    key: 'academic_info',
    title: 'Academic details',
    icon: GraduationCap,
    preview: (t: any) =>
      t?.profile_type === 'WORKING_PROFESSIONAL'
        ? [{ k: 'Company', v: dash(t?.office_name) }, { k: 'Role', v: dash(t?.job_role) }]
        : [{ k: 'College', v: dash(t?.college_name) }, { k: 'Course', v: dash(t?.course) }],
  },
];

const SUPPORT_ITEMS = [
  { title: 'Help & support', sub: 'Chat with the hostel team', to: '/tenant/profile/help' as const },
  { title: 'Notifications', sub: 'Manage alerts & reminders', icon: Bell },
  { title: 'Language', sub: 'English (India)', icon: Globe },
  { title: 'Privacy & security', sub: 'Password & login', icon: Lock },
];

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
  const liveTenancy = hasLiveTenancy(user);
  const tenantProfile = useTenantProfile();
  const overlay = useOverlayStack();

  const editConfigs = useMemo(
    () => buildProfileEditConfigs(tenantProfile.tenant, tenantProfile.profile, tenantProfile.contacts, tenantProfile.documents, tenantProfile.verification),
    [tenantProfile.tenant, tenantProfile.profile, tenantProfile.contacts, tenantProfile.documents, tenantProfile.verification],
  );

  const pendingCount = disclosures?.pending_requests.length ?? 0;

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
              onClick={() => navigate('/profile/saved')}
            />
            <ActivityTile
              icon={ClipboardList}
              count={enquiries?.length ?? 0}
              label="Enquiries"
              tint="#F0E8DF"
              iconColor={C.textMuted}
              onClick={() => navigate('/profile/enquiries')}
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
          {identity && (
            <div className="relative mt-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold" style={{ color: '#B6ABA0' }}>Profile completeness</span>
                <span className="font-display text-[12px] font-extrabold" style={{ color: C.clayPale }}>{identity.completion_percent}%</span>
              </div>
              <div className="mt-1.5 h-[6px] overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,.08)' }}>
                <div className="h-full rounded-full" style={{ width: `${identity.completion_percent}%`, background: `linear-gradient(90deg, ${C.clayDeep}, ${C.clayPale})` }} />
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={() => navigate('/profile/details')}
            className="relative mt-3.5 w-full rounded-[11px] py-3 text-[13px] font-extrabold"
            style={{ fontFamily: FONT.display, background: C.clayLight, color: C.ink }}
          >
            {identity?.is_complete ? 'Review your details' : 'Complete your details'}
          </button>
        </section>

        {/* Tenancy-scoped details — only meaningful with a live tenancy, since
            phone/email here save through this hostel's owner-approval flow
            (GOVERNED_PROFILE_FIELDS), distinct from the portable card above. */}
        {liveTenancy && (
          <section>
            <h2 className="mb-2.5 pl-0.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
              Your details (this stay)
            </h2>
            {tenantProfile.pendingProfileRequest && (
              <div
                className="mb-2.5 flex items-center gap-2.5 rounded-2xl border px-4 py-3"
                style={{ borderColor: '#F1E2C4', background: '#FBF1DE' }}
              >
                <Lock className="h-4 w-4 flex-none" style={{ color: C.amber }} />
                <p className="flex-1 text-[12px] font-semibold" style={{ color: '#7A5A24' }}>A change you requested is awaiting owner approval.</p>
              </div>
            )}
            <div className="flex flex-col gap-2.5">
              {TENANCY_DETAIL_GROUPS.map(({ key, title, icon: Icon, preview }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => overlay.push(key)}
                  className="rounded-2xl border bg-white p-[15px_16px] text-left"
                  style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px]" style={{ background: '#F5E9E3', color: C.clay }}>
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-semibold" style={{ color: C.inkSoft }}>{title}</div>
                    </div>
                    <ChevronRight className="h-4 w-4 flex-none" style={{ color: '#C9BFB4' }} />
                  </div>
                  <div className="mt-3 flex flex-col gap-2 border-t pt-[11px]" style={{ borderColor: C.lineSoft }}>
                    {preview(tenantProfile.tenant, tenantProfile.profile, tenantProfile.contacts).map((row) => (
                      <div key={row.k} className="flex items-center justify-between gap-3">
                        <span className="text-[12px] font-medium" style={{ color: C.textMuted }}>{row.k}</span>
                        <span className="text-right text-[12.5px] font-semibold" style={{ color: C.inkSoft }}>{row.v}</span>
                      </div>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Documents — the portable vault always; this hostel's KYC only with a live tenancy (see ProfileDocumentsPage). */}
        <section>
          <h2 className="mb-2.5 pl-0.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
            Documents
          </h2>
          <button
            type="button"
            onClick={() => navigate('/profile/documents')}
            className="flex w-full items-center gap-3.5 rounded-2xl border bg-white px-4 py-3.5 text-left"
            style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}
          >
            <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px]" style={{ background: '#F4EEE7' }}>
              <FileText className="h-[17px] w-[17px]" strokeWidth={1.8} style={{ color: C.textMuted }} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13.5px] font-semibold" style={{ color: C.inkSoft }}>Documents</span>
              <span className="block truncate text-[11px]" style={{ color: C.textFaint }}>Your vault{liveTenancy ? ' & this hostel’s verification' : ''}</span>
            </span>
            {liveTenancy && tenantProfile.missingDocuments.length > 0 && (
              <span className="flex-none rounded-full px-2.5 py-1 text-[10.5px] font-bold" style={{ background: '#FBF1DE', color: C.amber }}>
                {tenantProfile.missingDocuments.length} pending
              </span>
            )}
            <ChevronRight className="h-4 w-4 flex-none" style={{ color: '#C9BFB4' }} />
          </button>
        </section>

        {/* Stay history — with any pending request surfaced, since it needs an answer */}
        <section>
          <h2 className="mb-2.5 pl-0.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
            Your record
          </h2>
          <button
            type="button"
            onClick={() => navigate('/profile/history')}
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
            <Row
              icon={ShieldCheck}
              title="Safety & trust"
              sub="How Stayo verifies the hostels it lists"
              onClick={() => navigate('/about')}
              first
            />
            <Row
              icon={LifeBuoy}
              title="Help & contact"
              sub="Questions about a hostel or your account"
              onClick={() => navigate('/contact')}
            />
          </div>
        </section>

        <section>
          <h2 className="mb-2.5 pl-0.5 text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: '#9C9186' }}>
            Support &amp; settings
          </h2>
          <div
            className="overflow-hidden rounded-2xl border bg-white divide-y"
            style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}
          >
            {SUPPORT_ITEMS.map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={() => ('to' in item && item.to ? navigate(item.to) : stayoToast.info(`${item.title} — coming soon`))}
                className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                style={{ borderColor: C.lineSoft }}
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold" style={{ color: C.inkSoft }}>{item.title}</div>
                  <div className="mt-0.5 text-[11.5px]" style={{ color: C.textFaint }}>{item.sub}</div>
                </div>
                <ChevronRight className="h-4 w-4 flex-none" style={{ color: '#C9BFB4' }} />
              </button>
            ))}
          </div>
        </section>

        <button
          type="button"
          onClick={() => logout(true)}
          className="flex w-full items-center justify-center gap-2 py-2 text-center text-[13.5px] font-bold"
          style={{ fontFamily: FONT.display, color: '#B3402F' }}
        >
          <LogOut className="h-4 w-4" /> Log out
        </button>
      </div>

      {!overlay.isHome && editConfigs[overlay.view] && (
        <ProfileEditScreen
          title={editConfigs[overlay.view].title}
          sub={editConfigs[overlay.view].sub}
          viewSections={editConfigs[overlay.view].viewSections}
          headPill={editConfigs[overlay.view].headPill}
          pillTone={editConfigs[overlay.view].pillTone}
          editButtonLabel={editConfigs[overlay.view].editButtonLabel}
          sections={editConfigs[overlay.view].sections}
          pendingRequest={tenantProfile.pendingProfileRequest}
          isSaving={tenantProfile.isUpdating || tenantProfile.isSubmittingChangeRequest}
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
          onSubmitGoverned={async (fields, reason) => {
            try {
              await tenantProfile.submitChangeRequest({ fields: fields as any, reason });
              stayoToast.success('Submitted for owner approval');
            } catch (err: any) {
              stayoToast.error(err?.response?.data?.error?.message || 'Could not submit — please try again');
              throw err;
            }
          }}
          onUploadDocument={triggerDocumentUpload}
        />
      )}
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
