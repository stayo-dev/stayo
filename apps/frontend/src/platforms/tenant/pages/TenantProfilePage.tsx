import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, User, Phone, ShieldAlert, GraduationCap, FileText, LifeBuoy, Bell, Globe, Lock, LogOut, MessageSquareWarning, Bug, Upload, Loader2 } from 'lucide-react';
import { useAuth } from '@context/AuthContext';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useTenantProfile } from '@features/tenant-profile/hooks/useTenantProfile';
import { useTenantRoom } from '@features/tenant-room/hooks/useTenantRoom';
import { tenantRoomService } from '@features/tenant-room/api';
import { useOverlayStack } from '../components/overlays/useOverlayStack';
import { DetailScreen } from '../components/overlays/DetailScreen';
import { FormPanel } from '../components/overlays/FormPanel';
import { ProfileEditScreen } from '../components/overlays/ProfileEditScreen';
import { buildProfileEditConfigs } from '../components/overlays/configs/profileEditConfigs';
import { buildServiceRequestFormConfigs } from '../components/overlays/configs/serviceRequestFormConfigs';
import { buildServiceRequestDetailConfig } from '../components/overlays/configs/serviceRequestDetailConfig';

const card = 'rounded-[16px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_4px_14px_rgba(40,30,20,0.05)]';
const sectionLabel = 'text-[13px] font-bold uppercase tracking-wide text-muted-foreground';

const dash = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));
const dateLabel = (v: unknown) => (v ? new Date(String(v)).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const DETAIL_GROUPS = [
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

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 pt-6 sm:px-6">
      <div className="h-40 animate-pulse rounded-2xl bg-muted" />
      <div className="h-28 animate-pulse rounded-2xl bg-muted" />
      <div className="h-28 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

/** Tenant Profile tab, per Stayo Tenant.dc.html. Detail drill-ins and ticket flows use the shared overlay system, real data via `useTenantProfile()` + `useTenantRoom()` (tickets = service requests, shared with the Room tab). */
export function TenantProfilePage() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const profile = useTenantProfile();
  const room = useTenantRoom();
  const overlay = useOverlayStack();

  const editConfigs = useMemo(
    () => buildProfileEditConfigs(profile.tenant, profile.profile, profile.contacts, profile.documents, profile.verification),
    [profile.tenant, profile.profile, profile.contacts, profile.documents, profile.verification],
  );
  const formConfigs = useMemo(() => buildServiceRequestFormConfigs({ createRequest: room.createRequest }), [room.createRequest]);

  /** Opens a native file picker for a given document type and uploads it — used by Personal information's Aadhaar row, which re-routes to the document flow instead of a text input. */
  const triggerDocumentUpload = (docType: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/jpeg,image/png,image/webp,application/pdf';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      profile
        .uploadDocument({ docType, file })
        .then(() => stayoToast.success('Document uploaded'))
        .catch((err: any) => stayoToast.error(err?.response?.data?.error?.message || 'Could not upload — please try again'));
    };
    input.click();
  };

  const activeTicketId = overlay.view.startsWith('tk_') ? overlay.view.slice(3) : null;
  const activeTicket = activeTicketId ? room.requests.find((r) => r.id === activeTicketId) ?? null : null;
  const ticketEventsQuery = useQuery({
    queryKey: ['tenant', 'service-requests', activeTicketId, 'events'],
    queryFn: () => tenantRoomService.getServiceRequestDetail(activeTicketId!),
    enabled: Boolean(activeTicketId && activeTicket),
  });

  if (profile.isLoading || room.isLoading) return <LoadingSkeleton />;

  const t = profile.tenant;
  const p = profile.profile;
  const completenessFields = [p?.name, p?.phone, p?.email, t?.date_of_birth, t?.gender, t?.guardian_name, p?.city, t?.photo_url, t?.profile_type === 'WORKING_PROFESSIONAL' ? t?.office_name : t?.college_name];
  const completeness = Math.round((completenessFields.filter(Boolean).length / completenessFields.length) * 100);

  const openTickets = room.requests.filter((r) => r.status !== 'RESOLVED' && r.status !== 'REJECTED');

  return (
    <div className="min-h-screen">
      <div className="flex flex-col gap-6 px-[22px] pb-8 pt-6">
        <div>
          <h1 className="font-display text-[24px] font-extrabold tracking-[-0.03em] text-foreground">Profile</h1>
          <p className="mt-0.5 text-[12px] font-medium text-muted-foreground">Your details, documents &amp; support</p>
        </div>

        <div className="overflow-hidden rounded-[22px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_12px_30px_rgba(40,30,20,0.08)]">
          <div className="relative h-[76px] overflow-hidden" style={{ background: 'linear-gradient(115deg, #A85C48, #C97E5F 55%, #E3AC87)' }}>
            <div className="pointer-events-none absolute -right-[34px] -top-[46px] h-[150px] w-[150px] rounded-full bg-white/[0.12]" />
            <div className="pointer-events-none absolute right-[54px] top-[26px] h-[72px] w-[72px] rounded-full bg-white/[0.09]" />
          </div>
          <div className="relative -mt-8 px-5 pb-5">
            <div className="flex items-end justify-between">
              <span className="flex h-[66px] w-[66px] items-center justify-center rounded-[20px] border-[3px] border-card bg-foreground font-display text-[26px] font-extrabold text-background shadow-[0_8px_18px_rgba(34,30,26,0.22)]">
                {(p?.name ?? 'T').charAt(0).toUpperCase()}
              </span>
              <span className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-[#EADFD3] bg-[#F5EEE7] px-3.5 py-1.5 font-display text-[11.5px] font-bold text-[#8A5A48]">
                Edit
              </span>
            </div>
            <div className="mt-3.5 flex items-center gap-2">
              <span className="whitespace-nowrap font-display text-[21px] font-extrabold tracking-[-0.02em] text-foreground">{p?.name ?? 'You'}</span>
              {profile.verification?.overall === 'VERIFIED' && (
                <span className="flex-none rounded-full border border-[#CFE9DA] bg-success-bg px-2.5 py-1 text-[10px] font-bold text-success">KYC verified</span>
              )}
            </div>
            {profile.room?.room_no && (
              <div className="mt-0.5 text-[12.5px] font-medium text-muted-foreground">Room {profile.room.room_no}</div>
            )}
            <div className="mt-4 flex gap-2">
              {[
                { k: 'Room', v: profile.room?.room_no ?? '—' },
                { k: 'Sharing', v: profile.room?.capacity ? `${profile.room.capacity}-share` : '—' },
                { k: 'Status', v: t?.status ?? '—' },
              ].map((c) => (
                <div key={c.k} className="flex-1 rounded-[13px] border border-[#F0E7DC] bg-[#F8F2EC] p-[10px_12px]">
                  <div className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[#A6988A]">{c.k}</div>
                  <div className="mt-0.5 font-display text-[15px] font-extrabold tracking-[-0.01em] text-foreground">{c.v}</div>
                </div>
              ))}
            </div>
            <div className="mt-4 border-t border-border pt-[15px]">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11.5px] font-semibold text-muted-foreground">Profile completeness</span>
                <span className="font-display text-[12px] font-extrabold text-primary">{completeness}%</span>
              </div>
              <div className="h-[7px] overflow-hidden rounded-full bg-[#F0E7DC]">
                <div className="h-full rounded-full" style={{ width: `${completeness}%`, background: 'linear-gradient(90deg, #A85C48, #E0A57F)' }} />
              </div>
              {completeness < 100 && (
                <p className="mt-2 text-[11px] font-medium text-[#A6988A]">Complete your profile to reach 100%</p>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <span className={sectionLabel}>Your details</span>
          {profile.pendingProfileRequest && (
            <div className="flex items-center gap-2.5 rounded-2xl border border-[#F1E2C4] bg-warning-bg px-4 py-3">
              <Lock className="h-4 w-4 flex-none text-warning" />
              <p className="flex-1 text-[12px] font-semibold text-[#7A5A24]">A change you requested is awaiting owner approval.</p>
            </div>
          )}
          {DETAIL_GROUPS.map(({ key, title, icon: Icon, preview }) => (
            <button key={key} type="button" onClick={() => overlay.push(key)} className={`${card} p-[15px_16px] text-left`}>
              <div className="flex items-center gap-3">
                <span className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] bg-[#F5E9E3] text-primary">
                  <Icon className="h-[18px] w-[18px]" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-[#2A2521]">{title}</div>
                </div>
                <ChevronRight className="h-4 w-4 flex-none text-[#C9BFB4]" />
              </div>
              <div className="mt-3 flex flex-col gap-2 border-t border-[#F2ECE5] pt-[11px]">
                {preview(profile.tenant, profile.profile, profile.contacts).map((row) => (
                  <div key={row.k} className="flex items-center justify-between gap-3">
                    <span className="text-[12px] font-medium text-muted-foreground">{row.k}</span>
                    <span className="text-right text-[12.5px] font-semibold text-[#2A2521]">{row.v}</span>
                  </div>
                ))}
              </div>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between">
            <span className={sectionLabel}>Documents</span>
            {profile.missingDocuments.length > 0 && (
              <span className="text-[11px] font-semibold text-warning">{profile.missingDocuments.length} pending</span>
            )}
          </div>
          <div className={`${card} divide-y divide-[#F2ECE5] px-4`}>
            {profile.documents.map((d: any) => {
              const isAgreement = d.doc_type === 'RENTAL_AGREEMENT';
              const verified = isAgreement || d.document_status === 'VERIFIED' || d.is_verified;
              const label = isAgreement ? 'Signed' : verified ? 'Verified' : d.document_status === 'REJECTED' ? 'Rejected' : 'Pending';
              return (
                <div key={d.id} className="flex items-center gap-3 py-3.5">
                  <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] bg-[#F5E9E3] text-primary">
                    <FileText className="h-4 w-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold text-[#2A2521]">{d.doc_type_label ?? profile.docLabel[d.doc_type] ?? d.doc_type}</div>
                    <div className="mt-0.5 text-[11.5px] font-medium text-muted-foreground">{label} · {dateLabel(d.uploaded_at ?? d.created_at)}</div>
                  </div>
                  <span className={`flex-none rounded-full px-2.5 py-1 text-[10.5px] font-bold ${verified ? 'bg-success-bg text-success' : label === 'Rejected' ? 'bg-destructive-bg text-destructive' : 'bg-warning-bg text-warning'}`}>
                    {label}
                  </span>
                </div>
              );
            })}
            {profile.missingDocuments.map((d) => (
              <label key={d.doc_type} className="flex w-full cursor-pointer items-center gap-3 py-3.5 text-left">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  className="hidden"
                  disabled={profile.isUploadingDocument}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = '';
                    if (!file) return;
                    profile
                      .uploadDocument({ docType: d.doc_type, file })
                      .then(() => stayoToast.success(`${d.doc_type_label} uploaded`))
                      .catch(() => stayoToast.error('Could not upload — please try again'));
                  }}
                />
                <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] bg-[#F5E9E3] text-primary">
                  {profile.isUploadingDocument ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-[#2A2521]">{d.doc_type_label}</div>
                  <div className="mt-0.5 text-[11.5px] font-medium text-muted-foreground">Not uploaded yet</div>
                </div>
                <span className="flex flex-none items-center gap-1.5 rounded-full bg-warning-bg px-2.5 py-1 text-[10.5px] font-bold text-warning">
                  <Upload className="h-3 w-3" /> Upload
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between">
            <span className={sectionLabel}>Tickets &amp; bug reports</span>
            {openTickets.length > 0 && <span className="rounded-full bg-warning-bg px-2.5 py-[3px] text-[10px] font-bold text-warning">{openTickets.length} open</span>}
          </div>
          <div className={`${card} p-4`}>
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => overlay.push('raise_ticket')}
                className="flex flex-1 flex-col items-center gap-2 rounded-[14px] p-[15px_10px] text-white shadow-[0_8px_18px_rgba(164,93,68,0.24)]"
                style={{ background: 'linear-gradient(135deg, #B46A55, #C97E5F)' }}
              >
                <MessageSquareWarning className="h-[21px] w-[21px]" strokeWidth={1.9} />
                <span className="font-display text-[12.5px] font-bold">Raise a ticket</span>
              </button>
              <button type="button" onClick={() => overlay.push('report_bug')} className="flex flex-1 flex-col items-center gap-2 rounded-[14px] border border-[#F0E7DC] bg-[#F8F2EC] p-[15px_10px] text-[#8A5A48]">
                <Bug className="h-5 w-5 text-primary" strokeWidth={1.8} />
                <span className="font-display text-[12.5px] font-bold">Report a bug</span>
              </button>
            </div>
            {room.requests.length > 0 && (
              <>
                <div className="mt-1 divide-y divide-[#F2ECE5]">
                  {room.requests.slice(0, 5).map((t) => (
                    <button key={t.id} type="button" onClick={() => overlay.push(`tk_${t.id}`)} className="flex w-full items-center gap-3 py-3.5 text-left">
                      <span className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] bg-[#F5E9E3] text-primary">
                        {t.category?.toLowerCase().includes('bug') ? <Bug className="h-4 w-4" /> : <MessageSquareWarning className="h-4 w-4" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-semibold text-[#2A2521]">{t.category ?? t.type.replace('_', ' ')}</div>
                        <div className="mt-0.5 text-[11px] font-medium text-muted-foreground">{new Date(t.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</div>
                      </div>
                      <span className="flex-none rounded-full bg-warning-bg px-2.5 py-1 text-[10px] font-bold text-warning">{t.status.replace('_', ' ')}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <span className={sectionLabel}>Support &amp; settings</span>
          <div className={`${card} divide-y divide-border px-4`}>
            {SUPPORT_ITEMS.map((item) => (
              <button
                key={item.title}
                type="button"
                onClick={() => ('to' in item && item.to ? navigate(item.to) : stayoToast.info(`${item.title} — coming soon`))}
                className="flex w-full items-center gap-3 py-3.5 text-left"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-[13.5px] font-semibold text-[#2A2521]">{item.title}</div>
                  <div className="mt-0.5 text-[11.5px] font-medium text-muted-foreground">{item.sub}</div>
                </div>
                <ChevronRight className="h-4 w-4 flex-none text-[#C9BFB4]" />
              </button>
            ))}
          </div>
          <button type="button" onClick={() => logout()} className="flex items-center justify-center gap-2 rounded-[14px] border border-[#EFD9D2] bg-card py-[15px] font-display text-sm font-bold text-[#B0503A]">
            <LogOut className="h-4 w-4" /> Log out
          </button>
        </div>

        <p className="pt-0.5 text-center text-[11px] font-medium text-[#B7AC9F]">Stayo{profile.hostel?.name ? ` · ${profile.hostel.name}` : ''}</p>
      </div>

      {activeTicket && (
        <DetailScreen config={buildServiceRequestDetailConfig(activeTicket, ticketEventsQuery.data?.tenant_service_request_events ?? [])} onBack={overlay.back} />
      )}
      {!overlay.isHome && !activeTicketId && editConfigs[overlay.view] && (
        <ProfileEditScreen
          title={editConfigs[overlay.view].title}
          sub={editConfigs[overlay.view].sub}
          viewSections={editConfigs[overlay.view].viewSections}
          headPill={editConfigs[overlay.view].headPill}
          pillTone={editConfigs[overlay.view].pillTone}
          editButtonLabel={editConfigs[overlay.view].editButtonLabel}
          sections={editConfigs[overlay.view].sections}
          pendingRequest={profile.pendingProfileRequest}
          isSaving={profile.isUpdating || profile.isSubmittingChangeRequest}
          onBack={overlay.back}
          onSaveDirect={async (patch) => {
            try {
              await profile.updateProfile(patch);
              stayoToast.success('Saved');
            } catch (err: any) {
              stayoToast.error(err?.response?.data?.error?.message || 'Could not save — please try again');
              throw err;
            }
          }}
          onSubmitGoverned={async (fields, reason) => {
            try {
              await profile.submitChangeRequest({ fields: fields as any, reason });
              stayoToast.success('Submitted for owner approval');
            } catch (err: any) {
              stayoToast.error(err?.response?.data?.error?.message || 'Could not submit — please try again');
              throw err;
            }
          }}
          onUploadDocument={triggerDocumentUpload}
        />
      )}
      {!overlay.isHome && formConfigs[overlay.view] && (
        <FormPanel config={formConfigs[overlay.view]} onBack={overlay.back} onClose={overlay.close} />
      )}
    </div>
  );
}
