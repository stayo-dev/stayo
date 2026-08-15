import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Send,
  Copy,
  ChevronRight,
  Clock,
  Plus,
  Trash2,
  AlertTriangle,
  XCircle,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import { StatusPill } from '@shared/ui-patterns/StatusPill';
import { canonicalPhone, formatIndianPhone, toLocalPhone } from '@shared/lib/phone';
import { queryKeys } from '@lib/queryKeys';
import { tenantService } from '@features/tenants/api';
import type { RealTenantDetail } from '../hooks/useTenantDetail';
import { useTenantNotes } from '../hooks/useTenantNotes';
import { CancelInvitationModal } from '../actions/CancelInvitationModal';
import { InvitationTimeline } from '../invitation/InvitationTimeline';
import { TermEditSheet, type TermFieldKind } from '../invitation/TermEditSheet';
import { RoomPickerSheet, type RoomChoice } from '../invitation/RoomPickerSheet';
import { ReviewChangesSheet } from '../invitation/ReviewChangesSheet';
import {
  computeMoveInTotal,
  deriveInvitationProgress,
  describeExpiry,
  diffTerms,
  formatMoney,
  missingTerms,
  relativeDayLabel,
  type DraftTerms,
} from '../invitation/invitationWorkspace';

/**
 * Pre-activation workspace for an invited tenant.
 *
 * Two questions drive the whole screen: *is the offer right?* and *has the
 * tenant acted on it?* Everything else was cut — the agreement preview (a
 * toast stub), the read-only "account status" checklist (nothing the owner can
 * act on), and the owner-side Activate button. A tenant becomes ACTIVE only by
 * finishing their own registration; the button that flipped them from here
 * bypassed that entirely.
 *
 * Edits collect locally as `edits` over the server's values and go out in one
 * deliberate send. That is not merely a UX preference: saving an invitation
 * rotates its token server-side, so every save re-issues the tenant's link.
 * Batching means one new link per intent instead of one per keystroke.
 */
export function InvitedTenantProfileView({ tenant }: { tenant: RealTenantDetail }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [edits, setEdits] = useState<Partial<DraftTerms>>({});
  const [editingField, setEditingField] = useState<keyof DraftTerms | null>(null);
  const [roomPickerOpen, setRoomPickerOpen] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [note, setNote] = useState('');
  const [isResending, setIsResending] = useState(false);

  const { notes, addNote, deleteNote } = useTenantNotes(tenant.id);
  const invitation = tenant.invitation;

  const current: DraftTerms = useMemo(
    () => ({
      name: tenant.name,
      phone: tenant.phone,
      email: tenant.email || invitation?.email || '',
      hostelId: tenant.hostelId,
      roomId: invitation?.reservedRoom?.id ?? '',
      roomLabel: invitation?.reservedRoom?.roomNo ?? (tenant.room !== '—' ? tenant.room : ''),
      joiningDate: toInputDate(tenant.stay.moveInDate),
      paymentFrequency: tenant.stay.billingFrequency || 'MONTHLY',
      monthlyRent: tenant.stay.monthlyRent,
      deposit: tenant.stay.deposit,
      maintenanceCharge: tenant.maintenanceCharge,
      maintenanceType: tenant.maintenanceType,
      agreementStartDate: toInputDate(invitation?.agreementStartDate) || toInputDate(tenant.stay.moveInDate),
      agreementDurationMonths: invitation?.agreementDurationMonths ?? 11,
    }),
    [tenant, invitation],
  );

  const draft: DraftTerms = useMemo(() => ({ ...current, ...edits }), [current, edits]);
  const changes = useMemo(() => diffTerms(current, draft), [current, draft]);
  const missing = useMemo(() => missingTerms(draft), [draft]);
  const progress = useMemo(() => deriveInvitationProgress(invitation, Date.now()), [invitation]);
  const expiry = describeExpiry(invitation?.expiresAt);
  const moveInTotal = computeMoveInTotal(draft);
  const isRegistering = progress.headline === 'Tenant is creating their account';

  const setField = (field: keyof DraftTerms, value: string | number) =>
    setEdits((prev) => ({ ...prev, [field]: value }));

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['owner', 'tenant', tenant.id, 'detail'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.tenants.all(tenant.hostelId) });
  };

  // ── Send updated invitation ───────────────────────────────────────────────
  // The endpoint validates the whole invitation, so the full merged draft is
  // sent even when one field changed. The old "edit personal details" action
  // sent only name+phone and was rejected every time for a missing room_id.
  const sendUpdate = useMutation({
    mutationFn: () =>
      tenantService.update(tenant.id, {
        invitation_edit: true,
        name: draft.name.trim(),
        phone: draft.phone.trim(),
        email: draft.email.trim().toLowerCase() || undefined,
        room_id: draft.roomId,
        joining_date: draft.joiningDate,
        payment_frequency: draft.paymentFrequency,
        monthly_rent: draft.monthlyRent,
        advance_amount: draft.deposit,
        maintenance_amount: draft.maintenanceCharge,
        maintenance_type: draft.maintenanceType,
        agreement_start_date: draft.agreementStartDate || undefined,
        agreement_duration_months: draft.agreementDurationMonths,
      }),
    onSuccess: (result: any) => {
      setEdits({});
      setReviewOpen(false);
      refresh();
      toast.success(
        result?.whatsapp_sent
          ? 'Updated invitation sent on WhatsApp'
          : result?.email_sent
            ? 'Updated invitation sent by email'
            : 'Invitation updated — share the new link manually',
      );
    },
    onError: (error: any) => {
      toast.error(error?.response?.data?.error?.message || 'Could not send the updated invitation');
    },
  });

  const handleResend = async () => {
    setIsResending(true);
    try {
      await tenantService.resendInvitation(tenant.phone);
      refresh();
      toast.success('Invitation resent');
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Failed to resend invitation');
    } finally {
      setIsResending(false);
    }
  };

  // The real activation link, built server-side from the invitation token.
  // This screen used to copy `/activate?token=<tenant uuid>` — a link that was
  // never valid for anyone.
  const handleCopyLink = async () => {
    if (!invitation?.activationLink) {
      toast.error('No active invitation link to copy');
      return;
    }
    await navigator.clipboard.writeText(invitation.activationLink);
    toast.success('Invitation link copied');
  };

  const handleCancelInvitation = async () => {
    try {
      await tenantService.cancelInvitation(tenant.id);
      toast.success('Invitation cancelled');
      refresh();
      navigate('/owner/tenants');
    } catch (error: any) {
      toast.error(error?.response?.data?.error?.message || 'Failed to cancel invitation');
      throw error;
    }
  };

  const handleRoomChoice = (choice: RoomChoice) => {
    setEdits((prev) => ({
      ...prev,
      roomId: choice.roomId,
      roomLabel: choice.roomLabel,
      ...(choice.applyDefaults && choice.defaults
        ? {
            monthlyRent: choice.defaults.monthlyRent,
            deposit: choice.defaults.deposit,
            maintenanceCharge: choice.defaults.maintenanceCharge,
            maintenanceType: choice.defaults.maintenanceType as DraftTerms['maintenanceType'],
          }
        : {}),
    }));
  };

  const changedFields = new Set(changes.map((change) => change.field));

  return (
    <div className="min-h-screen bg-background sm:mx-auto sm:max-w-[480px] sm:border-x sm:border-border pb-32">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-4 pb-4 pt-6 sm:px-6">
        <button
          type="button"
          onClick={() => navigate('/owner/tenants')}
          className="-ml-2 flex min-h-[44px] items-center gap-1.5 rounded-full px-2 text-muted-foreground active:scale-95 transition-transform"
        >
          <ArrowLeft className="h-5 w-5" strokeWidth={2} />
          <span className="text-[13px] font-bold">Tenants</span>
        </button>
        <StatusPill tone="warning" variant="filter">
          Invited
        </StatusPill>
      </div>

      <div className="flex flex-col gap-3 px-4 sm:px-6">
        {/* ── Who ───────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3.5">
          <span className="flex h-14 w-14 flex-none items-center justify-center rounded-2xl bg-gradient-to-br from-amber-600 to-amber-800 font-display text-lg font-extrabold text-white shadow-md">
            {tenant.initials}
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-[22px] font-extrabold leading-tight text-foreground">
              {draft.name}
            </h1>
            <p className="mt-0.5 text-[13px] font-semibold text-muted-foreground">
              {formatIndianPhone(draft.phone)}
              {draft.roomLabel ? ` · Room ${draft.roomLabel} held` : ''}
            </p>
          </div>
        </div>

        {/* ── Where the invitation stands ───────────────────────────────── */}
        <section className="rounded-[20px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-display text-[15px] font-extrabold leading-snug text-foreground">
                {progress.headline}
              </h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{progress.hint}</p>
            </div>
            <span
              className={`flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                expiry.tone === 'danger'
                  ? 'bg-destructive/10 text-destructive'
                  : expiry.tone === 'warning'
                    ? 'bg-warning/15 text-warning'
                    : 'bg-muted text-muted-foreground'
              }`}
            >
              <Clock className="h-3.5 w-3.5" strokeWidth={2.2} />
              {expiry.label}
            </span>
          </div>

          <InvitationTimeline steps={progress.steps} />

          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={handleResend}
              disabled={isResending}
              className={`flex min-h-[48px] flex-1 items-center justify-center gap-1.5 rounded-xl font-display text-[13px] font-bold shadow-sm active:scale-[0.98] transition-transform ${
                progress.needsNudge
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border bg-card text-foreground hover:bg-muted'
              }`}
            >
              <Send className="h-4 w-4" strokeWidth={2.2} />
              {isResending ? 'Sending…' : expiry.isExpired ? 'Send new link' : 'Nudge on WhatsApp'}
            </button>
            <button
              type="button"
              onClick={handleCopyLink}
              className="flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-4 font-display text-[13px] font-bold text-foreground hover:bg-muted active:scale-[0.98] transition-transform"
            >
              <Copy className="h-4 w-4 text-muted-foreground" strokeWidth={2} />
              Copy link
            </button>
          </div>

          {invitation && invitation.revision > 1 && (
            <p className="mt-3 text-[11.5px] font-semibold text-muted-foreground">
              Revised {invitation.revision - 1}{invitation.revision === 2 ? ' time' : ' times'} · sent{' '}
              {relativeDayLabel(invitation.sentAt) ?? 'recently'}
            </p>
          )}
        </section>

        {isRegistering && changes.length > 0 && (
          <div className="flex items-start gap-2.5 rounded-2xl border border-warning/30 bg-warning/10 p-3.5">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-warning" strokeWidth={2.2} />
            <p className="text-[12px] leading-relaxed text-foreground">
              This tenant is registering right now. Sending changes will replace the terms they are looking at.
            </p>
          </div>
        )}

        {/* ── The offer ─────────────────────────────────────────────────── */}
        <section className="overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="flex items-baseline justify-between border-b border-border px-4 py-3">
            <h2 className="font-display text-[14px] font-extrabold text-foreground">The offer</h2>
            <span className="text-[11px] font-semibold text-muted-foreground">Tap anything to change it</span>
          </div>

          <div className="divide-y divide-border/60">
            <TermRow label="Room" value={draft.roomLabel ? `Room ${draft.roomLabel}` : 'Not assigned'} changed={changedFields.has('roomId')} missing={!draft.roomId} onClick={() => setRoomPickerOpen(true)} />
            <TermRow label="Move-in" value={formatDisplayDate(draft.joiningDate)} changed={changedFields.has('joiningDate')} missing={!draft.joiningDate} onClick={() => setEditingField('joiningDate')} />
            <TermRow label="Monthly rent" value={formatMoney(draft.monthlyRent)} changed={changedFields.has('monthlyRent')} missing={!(draft.monthlyRent > 0)} emphasis onClick={() => setEditingField('monthlyRent')} />
            <TermRow label="Security deposit" value={formatMoney(draft.deposit)} changed={changedFields.has('deposit')} emphasis onClick={() => setEditingField('deposit')} />
            <TermRow
              label="Maintenance"
              value={draft.maintenanceCharge > 0 ? formatMoney(draft.maintenanceCharge) : 'None'}
              changed={changedFields.has('maintenanceCharge')}
              onClick={() => setEditingField('maintenanceCharge')}
            />
            {draft.maintenanceCharge > 0 && (
              <TermRow
                label="Charged"
                value={draft.maintenanceType === 'ONE_TIME' ? 'Once, at move-in' : 'Every month'}
                changed={changedFields.has('maintenanceType')}
                onClick={() => setEditingField('maintenanceType')}
              />
            )}
            <TermRow label="Billing" value={frequencyLabel(draft.paymentFrequency)} changed={changedFields.has('paymentFrequency')} onClick={() => setEditingField('paymentFrequency')} />
            <TermRow label="Agreement" value={`${draft.agreementDurationMonths} months`} changed={changedFields.has('agreementDurationMonths')} onClick={() => setEditingField('agreementDurationMonths')} />

            <div className="flex items-center justify-between bg-emerald-50/60 px-4 py-3.5">
              <span className="text-[12.5px] font-bold text-emerald-950">Due at move-in</span>
              <span className="font-display text-[16px] font-extrabold text-emerald-700">{formatMoney(moveInTotal)}</span>
            </div>
          </div>
        </section>

        {/* ── Contact ───────────────────────────────────────────────────── */}
        <section className="overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="border-b border-border px-4 py-3">
            <h2 className="font-display text-[14px] font-extrabold text-foreground">Contact</h2>
          </div>
          <div className="divide-y divide-border/60">
            <TermRow label="Name" value={draft.name} changed={changedFields.has('name')} onClick={() => setEditingField('name')} />
            <TermRow label="Phone" value={formatIndianPhone(draft.phone)} changed={changedFields.has('phone')} onClick={() => setEditingField('phone')} />
            <TermRow label="Email" value={draft.email || 'Not added'} changed={changedFields.has('email')} onClick={() => setEditingField('email')} />
          </div>
        </section>

        {/* ── Private notes ─────────────────────────────────────────────── */}
        <section className="flex flex-col gap-3 rounded-[20px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-[14px] font-extrabold text-foreground">Private notes</h2>
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Only you</span>
          </div>

          <form
            className="flex items-center gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              const content = note.trim();
              if (!content) return;
              addNote.mutate(content, {
                onSuccess: () => setNote(''),
                onError: () => toast.error('Could not save the note'),
              });
            }}
          >
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Something to remember…"
              className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-border bg-muted/40 px-3.5 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="submit"
              aria-label="Add note"
              disabled={addNote.isPending || !note.trim()}
              className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm disabled:opacity-40 active:scale-95 transition-transform"
            >
              <Plus className="h-4.5 w-4.5" strokeWidth={2.4} />
            </button>
          </form>

          {notes.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">No notes yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {notes.map((item) => (
                <li key={item.id} className="flex items-start gap-2 rounded-xl bg-muted/40 p-3">
                  <span className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-foreground">{item.content}</span>
                  <button
                    type="button"
                    aria-label="Delete note"
                    onClick={() => deleteNote.mutate(item.id)}
                    className="flex h-7 w-7 flex-none items-center justify-center rounded-full text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Cancel ────────────────────────────────────────────────────── */}
        <button
          type="button"
          onClick={() => setCancelOpen(true)}
          className="mb-2 flex min-h-[48px] items-center justify-center gap-2 rounded-2xl border border-destructive/20 bg-destructive/5 font-display text-[13px] font-bold text-destructive active:scale-[0.99] transition-transform"
        >
          <XCircle className="h-4 w-4" strokeWidth={2} />
          Cancel this invitation
        </button>
      </div>

      {/* ── Pending changes bar ─────────────────────────────────────────── */}
      {changes.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-border bg-card/95 p-3.5 backdrop-blur-md sm:mx-auto sm:max-w-[480px]">
          {missing.length > 0 && (
            <p className="mb-2 text-center text-[11.5px] font-bold text-warning">{missing[0].label}</p>
          )}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setEdits({})}
              aria-label="Discard changes"
              className="flex min-h-[52px] w-[52px] flex-none items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground active:scale-95 transition-transform"
            >
              <Undo2 className="h-4.5 w-4.5" strokeWidth={2} />
            </button>
            <button
              type="button"
              onClick={() => setReviewOpen(true)}
              disabled={missing.length > 0}
              className="flex min-h-[52px] flex-1 flex-col items-center justify-center rounded-2xl bg-primary font-display text-primary-foreground shadow-md disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              <span className="text-[14px] font-bold">Review &amp; send</span>
              <span className="text-[11px] font-semibold opacity-80">
                {changes.length} {changes.length === 1 ? 'change' : 'changes'} not sent yet
              </span>
            </button>
          </div>
        </div>
      )}

      {/* ── Sheets ──────────────────────────────────────────────────────── */}
      <RoomPickerSheet
        open={roomPickerOpen}
        onClose={() => setRoomPickerOpen(false)}
        hostelId={draft.hostelId}
        currentRoomId={draft.roomId}
        onSave={handleRoomChoice}
      />

      <FieldSheet field={editingField} draft={draft} onClose={() => setEditingField(null)} onSave={setField} />

      <ReviewChangesSheet
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        changes={changes}
        isSending={sendUpdate.isPending}
        onConfirm={() => sendUpdate.mutate()}
      />

      <CancelInvitationModal
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        tenantName={tenant.name}
        onConfirm={handleCancelInvitation}
      />
    </div>
  );
}

// ── Row ────────────────────────────────────────────────────────────────────

function TermRow({
  label,
  value,
  onClick,
  changed,
  missing,
  emphasis,
}: {
  label: string;
  value: string;
  onClick: () => void;
  changed?: boolean;
  missing?: boolean;
  emphasis?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[52px] w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/30"
    >
      <span className="flex items-center gap-1.5 text-[13px] font-semibold text-muted-foreground">
        {label}
        {changed && (
          <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-primary">
            edited
          </span>
        )}
      </span>
      <span className="flex min-w-0 items-center gap-1">
        <span
          className={`truncate font-display font-bold ${emphasis ? 'text-[15px]' : 'text-[14px]'} ${
            missing ? 'text-warning' : 'text-foreground'
          }`}
        >
          {value}
        </span>
        <ChevronRight className="h-4 w-4 flex-none text-muted-foreground/50" strokeWidth={2} />
      </span>
    </button>
  );
}

// ── One-field editors ──────────────────────────────────────────────────────

const FREQUENCY_OPTIONS = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Every 3 months' },
  { value: 'HALF_YEARLY', label: 'Every 6 months' },
  { value: 'ACADEMIC_YEARLY', label: 'Academic year' },
];

function frequencyLabel(value: string): string {
  return FREQUENCY_OPTIONS.find((option) => option.value === value)?.label ?? 'Monthly';
}

interface FieldConfig {
  title: string;
  kind: TermFieldKind;
  help?: string;
  options?: Array<{ value: string; label: string }>;
  numeric?: boolean;
  validate?: (value: string) => string | null;
}

const FIELD_CONFIG: Partial<Record<keyof DraftTerms, FieldConfig>> = {
  name: {
    title: "Tenant's name",
    kind: 'text',
    help: 'Fixing a spelling here also corrects it on the agreement they will sign.',
    validate: (v) => (v.trim().length < 2 ? 'Enter at least 2 characters' : null),
  },
  phone: {
    title: 'Phone number',
    kind: 'phone',
    help: 'The invitation is delivered to this number, so changing it re-sends to the new one.',
    validate: (v) => (/^\d{10}$/.test(v.replace(/\D/g, '').slice(-10)) ? null : 'Enter a 10-digit mobile number'),
  },
  email: {
    title: 'Email',
    kind: 'email',
    help: 'Optional — used as a fallback if WhatsApp delivery fails.',
    validate: (v) => (!v.trim() || /.+@.+\..+/.test(v.trim()) ? null : 'Enter a valid email address'),
  },
  joiningDate: { title: 'Move-in date', kind: 'date', help: 'Rent is charged from this date.' },
  monthlyRent: {
    title: 'Monthly rent',
    kind: 'money',
    numeric: true,
    validate: (v) => (Number(v) > 0 ? null : 'Rent must be more than zero'),
  },
  deposit: { title: 'Security deposit', kind: 'money', numeric: true, help: 'Refundable at move-out, after settlement.' },
  maintenanceCharge: { title: 'Maintenance charge', kind: 'money', numeric: true, help: 'Set to 0 if you do not charge maintenance.' },
  maintenanceType: {
    title: 'How is maintenance charged?',
    kind: 'select',
    options: [
      { value: 'MONTHLY', label: 'Every month' },
      { value: 'ONE_TIME', label: 'Once, at move-in' },
      { value: 'NONE', label: 'Not charged' },
    ],
  },
  paymentFrequency: { title: 'Billing frequency', kind: 'select', options: FREQUENCY_OPTIONS, help: 'How often rent is billed.' },
  agreementDurationMonths: {
    title: 'Agreement duration',
    kind: 'months',
    numeric: true,
    help: 'In months. Most hostels use 11 or 12.',
    validate: (v) => (Number(v) >= 1 && Number(v) <= 120 ? null : 'Enter between 1 and 120 months'),
  },
};

function FieldSheet({
  field,
  draft,
  onClose,
  onSave,
}: {
  field: keyof DraftTerms | null;
  draft: DraftTerms;
  onClose: () => void;
  onSave: (field: keyof DraftTerms, value: string | number) => void;
}) {
  const config = field ? FIELD_CONFIG[field] : undefined;
  if (!field || !config) return null;

  // The input holds the 10 local digits an owner actually types; the draft
  // holds the E.164 form the backend stores. Without this split the field
  // shows "+918008046952", and re-typing it reads as a change to itself.
  const value = field === 'phone' ? toLocalPhone(draft.phone) : String(draft[field] ?? '');

  return (
    <TermEditSheet
      open
      onClose={onClose}
      title={config.title}
      help={config.help}
      kind={config.kind}
      options={config.options}
      value={value}
      validate={config.validate}
      onSave={(next) =>
        onSave(field, field === 'phone' ? canonicalPhone(next) || next : config.numeric ? Number(next || 0) : next)
      }
    />
  );
}

// ── Dates ──────────────────────────────────────────────────────────────────

/** Accepts both an ISO timestamp and the "15 Aug 2026" the detail hook formats. */
function toInputDate(value: string | null | undefined): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const offset = parsed.getTimezoneOffset() * 60_000;
  return new Date(parsed.getTime() - offset).toISOString().split('T')[0];
}

function formatDisplayDate(value: string): string {
  if (!value) return 'Not set';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Not set';
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
