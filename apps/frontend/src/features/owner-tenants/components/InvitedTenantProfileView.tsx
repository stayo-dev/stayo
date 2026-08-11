import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Pencil,
  Send,
  Copy,
  BedDouble,
  IndianRupee,
  Calendar,
  FileText,
  StickyNote,
  Plus,
  Check,
  Building2,
  Clock,
  UserCheck,
  CheckCircle2,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { StatusPill } from '@shared/ui-patterns/StatusPill';
import { queryKeys } from '@lib/queryKeys';
import { tenantService } from '@features/tenants/api';
import type { RealTenantDetail } from '../hooks/useTenantDetail';
import { InvitedTenantActionsSheet } from '../actions/InvitedTenantActionsSheet';
import { CancelInvitationModal } from '../actions/CancelInvitationModal';
import { EditTenantModal } from '../actions/EditTenantModal';
import { EditInviteModal } from '@/app/components/modals/EditInviteModal';

interface InvitedTenantProfileViewProps {
  tenant: RealTenantDetail;
}

export function InvitedTenantProfileView({ tenant }: InvitedTenantProfileViewProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [actionsOpen, setActionsOpen] = useState(false);
  const [editInviteOpen, setEditInviteOpen] = useState(false);
  const [editTenantOpen, setEditTenantOpen] = useState(false);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);

  const [note, setNote] = useState('');
  const [notesList, setNotesList] = useState<string[]>([
    'Student requested lower-floor room.',
    'Parent will pay deposit on move-in.',
  ]);

  const [isResending, setIsResending] = useState(false);
  const [isActivating, setIsActivating] = useState(false);

  // Derive setup readiness
  const hasRoom = Boolean(tenant.room && tenant.room !== '—');
  const hasRent = tenant.stay.monthlyRent > 0;
  const isReadyToActivate = hasRoom && hasRent;

  const missingItems: string[] = [];
  if (!hasRoom) missingItems.push('Room not assigned');
  if (!hasRent) missingItems.push('Rent terms not configured');

  // Handle Resend Invitation
  const handleResend = async () => {
    setIsResending(true);
    try {
      await tenantService.resendInvitation(tenant.phone);
      toast.success(`✓ Invitation resent to +91 ${tenant.phone}`);
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || 'Failed to resend invitation');
    } finally {
      setIsResending(false);
    }
  };

  // Handle Copy Invitation Link
  const handleCopyLink = () => {
    const link = `${window.location.origin}/activate?token=${tenant.id}`;
    navigator.clipboard.writeText(link).then(() => {
      toast.success('✓ Invitation link copied to clipboard');
    });
  };

  // Handle Cancel Invitation
  const handleConfirmCancel = async () => {
    try {
      await tenantService.cancelInvitation(tenant.id);
      toast.success('Invitation cancelled. Record retained for 30 days.');
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenant', tenant.id, 'detail'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.tenants.all(tenant.hostelId) });
      navigate('/owner/tenants');
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || 'Failed to cancel invitation');
      throw e;
    }
  };

  // Handle Edit Personal Details
  const handleSaveTenantDetails = async (data: { name: string; phone: string }) => {
    try {
      await tenantService.update(tenant.id, {
        invitation_edit: true,
        name: data.name,
        phone: data.phone,
      });
      toast.success('Tenant details updated');
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenant', tenant.id, 'detail'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.tenants.all(tenant.hostelId) });
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || 'Failed to update tenant details');
      throw e;
    }
  };

  // Handle Activate Tenant
  const handleActivate = async () => {
    setIsActivating(true);
    try {
      await tenantService.reactivate(tenant.id, { status: 'ACTIVE' });
      toast.success('Tenant tenancy activated successfully!');
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenant', tenant.id, 'detail'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.tenants.all(tenant.hostelId) });
    } catch (e: any) {
      toast.error(e?.response?.data?.error?.message || 'Could not activate tenant');
    } finally {
      setIsActivating(false);
    }
  };

  // Add Private Note
  const handleAddNote = () => {
    if (!note.trim()) return;
    setNotesList((prev) => [note.trim(), ...prev]);
    setNote('');
    toast.success('Private note added');
  };

  return (
    <div className="min-h-screen bg-background [background-image:linear-gradient(#EBDCCF_1px,transparent_1px),linear-gradient(90deg,#EBDCCF_1px,transparent_1px)] [background-size:52px_52px] sm:mx-auto sm:max-w-[480px] sm:border-x sm:border-border pb-28">
      {/* Top Header Bar */}
      <div className="flex items-center justify-between px-4 pb-3 pt-6 sm:px-6">
        <button
          type="button"
          onClick={() => navigate('/owner/tenants')}
          aria-label="Back"
          className="flex items-center gap-2 rounded-full border border-border bg-card px-3.5 py-1.5 shadow-sm active:scale-95 transition-transform"
        >
          <ArrowLeft className="h-4 w-4 text-muted-foreground" strokeWidth={1.9} />
          <span className="text-[13px] font-bold text-foreground">Back to Tenants</span>
        </button>

        <span className="rounded-full bg-warning/15 px-3 py-1 font-display text-[11px] font-extrabold text-warning border border-warning/20">
          Pre-activation Workspace
        </span>
      </div>

      <div className="flex flex-col gap-3.5 px-4 sm:px-6">
        {/* 1. Header Profile Card */}
        <div className="rounded-[20px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="flex items-center gap-3.5">
            <span className="flex h-16 w-16 flex-none items-center justify-center rounded-2xl bg-gradient-to-br from-amber-600 to-amber-800 font-display text-xl font-extrabold text-white shadow-md">
              {tenant.initials}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <div className="font-display text-lg font-extrabold leading-tight text-foreground truncate">
                  {tenant.name}
                </div>
                <button
                  type="button"
                  onClick={() => setEditTenantOpen(true)}
                  aria-label="Edit Name & Phone"
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground hover:bg-secondary hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
              </div>

              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <StatusPill tone="warning" variant="filter">
                  ● Invitation pending
                </StatusPill>
                <span className="text-[11.5px] text-muted-foreground">
                  Joined <b className="font-bold text-foreground">{tenant.joinedDate || '04 Aug 2026'}</b>
                </span>
              </div>

              <div className="mt-1 flex items-center gap-1 text-[12px] font-semibold text-muted-foreground">
                <span>+91 {tenant.phone}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 2. Invitation Status Card */}
        <div className="flex flex-col gap-3 rounded-[20px] border border-warning/30 bg-gradient-to-br from-warning/10 via-card to-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4.5 w-4.5 text-warning" strokeWidth={2} />
              <span className="font-display text-xs font-extrabold uppercase tracking-wide text-warning">
                INVITATION STATUS
              </span>
            </div>
            <span className="text-[11px] font-bold text-muted-foreground">Expires in 3 days</span>
          </div>

          <div>
            <div className="font-display text-[15px] font-extrabold text-foreground">
              Waiting for tenant to create account
            </div>
            <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
              Invitation link sent to <b className="font-semibold text-foreground">+91 {tenant.phone}</b>. The owner can prepare &amp; configure stay details before activation.
            </p>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={handleResend}
              disabled={isResending}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 font-display text-[12.5px] font-bold text-primary-foreground shadow-sm active:scale-[0.98] transition-transform"
            >
              <Send className="h-3.5 w-3.5" strokeWidth={2.2} />
              {isResending ? 'Sending…' : 'Resend invitation'}
            </button>
            <button
              type="button"
              onClick={handleCopyLink}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2.5 font-display text-[12.5px] font-bold text-foreground hover:bg-muted active:scale-[0.98] transition-transform"
            >
              <Copy className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={2} />
              Copy link
            </button>
          </div>
        </div>

        {/* 3. Primary Editable Area: STAY SETUP */}
        <div className="rounded-[20px] border border-border bg-card overflow-hidden shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2">
              <BedDouble className="h-4 w-4 text-primary" strokeWidth={2} />
              <span className="font-display text-[14px] font-extrabold text-foreground">STAY SETUP</span>
            </div>
            <button
              type="button"
              onClick={() => setEditInviteOpen(true)}
              className="text-[11.5px] font-bold text-primary hover:underline flex items-center gap-0.5"
            >
              Configure <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="divide-y divide-border/60">
            <button
              type="button"
              onClick={() => setEditInviteOpen(true)}
              className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-muted/30 transition-colors"
            >
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Hostel</span>
              <span className="font-display text-[13.5px] font-bold text-foreground flex items-center gap-1">
                {tenant.hostelName} <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
              </span>
            </button>

            <button
              type="button"
              onClick={() => setEditInviteOpen(true)}
              className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-muted/30 transition-colors"
            >
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Room / Bed</span>
              <span className={`font-display text-[13.5px] font-bold flex items-center gap-1 ${hasRoom ? 'text-foreground' : 'text-warning font-extrabold'}`}>
                {hasRoom ? tenant.stay.roomBed : '⚠ Assign room'} <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
              </span>
            </button>

            <button
              type="button"
              onClick={() => setEditInviteOpen(true)}
              className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-muted/30 transition-colors"
            >
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Move-in date</span>
              <span className="font-display text-[13.5px] font-bold text-foreground flex items-center gap-1">
                {tenant.stay.moveInDate || '04 Aug 2026'} <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
              </span>
            </button>

            <button
              type="button"
              onClick={() => setEditInviteOpen(true)}
              className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-muted/30 transition-colors"
            >
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Agreement period</span>
              <span className="font-display text-[13.5px] font-bold text-foreground flex items-center gap-1">
                {tenant.stay.agreementPeriod || '11 months'} <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
              </span>
            </button>
          </div>
        </div>

        {/* 4. FINANCIAL TERMS */}
        <div className="rounded-[20px] border border-border bg-card overflow-hidden shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2">
              <IndianRupee className="h-4 w-4 text-emerald-600" strokeWidth={2} />
              <span className="font-display text-[14px] font-extrabold text-foreground">FINANCIAL TERMS</span>
            </div>
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              Pre-activation Terms
            </span>
          </div>

          <div className="divide-y divide-border/60">
            <button
              type="button"
              onClick={() => setEditInviteOpen(true)}
              className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-muted/30 transition-colors"
            >
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Monthly Rent</span>
              <span className="font-display text-[14px] font-extrabold text-foreground flex items-center gap-1">
                ₹{tenant.stay.monthlyRent.toLocaleString('en-IN')} <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
              </span>
            </button>

            <button
              type="button"
              onClick={() => setEditInviteOpen(true)}
              className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-muted/30 transition-colors"
            >
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Security Deposit</span>
                <span className="ml-2 rounded-md bg-warning/10 px-1.5 py-0.5 text-[9.5px] font-bold text-warning">Not collected</span>
              </div>
              <span className="font-display text-[14px] font-extrabold text-foreground flex items-center gap-1">
                ₹{tenant.stay.deposit.toLocaleString('en-IN')} <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
              </span>
            </button>

            <button
              type="button"
              onClick={() => setEditInviteOpen(true)}
              className="w-full flex items-center justify-between px-4 py-3.5 text-left hover:bg-muted/30 transition-colors"
            >
              <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Billing frequency</span>
              <span className="font-display text-[13.5px] font-bold text-foreground flex items-center gap-1">
                {tenant.stay.billingFrequency || 'Monthly'} <ChevronRight className="h-4 w-4 text-muted-foreground/60" />
              </span>
            </button>

            <div className="flex items-center justify-between bg-emerald-50/50 px-4 py-3">
              <span className="text-[11.5px] font-extrabold text-emerald-950">Total due at move-in</span>
              <span className="font-display text-[15px] font-extrabold text-emerald-700">
                ₹{(tenant.stay.monthlyRent + tenant.stay.deposit).toLocaleString('en-IN')}
              </span>
            </div>
          </div>
        </div>

        {/* 5. AGREEMENT PROGRESS */}
        <div className="rounded-[20px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)] flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" strokeWidth={2} />
              <span className="font-display text-sm font-extrabold text-foreground">AGREEMENT</span>
            </div>
            <StatusPill tone="warning" variant="filter">Not signed yet</StatusPill>
          </div>

          <div className="rounded-xl bg-muted/50 p-3 text-[12px] leading-relaxed text-muted-foreground space-y-1">
            <div className="flex justify-between"><span>Monthly Rent</span><b className="font-bold text-foreground">₹{tenant.stay.monthlyRent.toLocaleString('en-IN')} / mo</b></div>
            <div className="flex justify-between"><span>Security Deposit</span><b className="font-bold text-foreground">₹{tenant.stay.deposit.toLocaleString('en-IN')}</b></div>
            <div className="flex justify-between"><span>Room &amp; Bed</span><b className="font-bold text-foreground">{tenant.stay.roomBed}</b></div>
            <div className="flex justify-between"><span>Move-in Date</span><b className="font-bold text-foreground">{tenant.stay.moveInDate || '04 Aug 2026'}</b></div>
          </div>

          <div className="flex gap-2 pt-1">
            <button
              type="button"
              onClick={() => toast.info('Previewing digital agreement template…')}
              className="flex-1 rounded-xl border border-border bg-card py-2.5 font-display text-[12.5px] font-bold text-foreground hover:bg-muted"
            >
              Preview agreement
            </button>
            <button
              type="button"
              onClick={() => handleResend()}
              className="flex-1 rounded-xl bg-secondary py-2.5 font-display text-[12.5px] font-bold text-primary hover:bg-secondary/80"
            >
              Send link
            </button>
          </div>
        </div>

        {/* 6. ACCOUNT STATUS / REGISTRATION READINESS */}
        <div className="rounded-[20px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)] flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-primary" strokeWidth={2} />
              <span className="font-display text-sm font-extrabold text-foreground">ACCOUNT STATUS</span>
            </div>
            <span className="text-[11px] font-bold text-muted-foreground">4 details pending</span>
          </div>

          <p className="text-[12px] leading-relaxed text-muted-foreground">
            The tenant will complete these required details during onboarding registration:
          </p>

          <div className="grid grid-cols-2 gap-2 text-[12px]">
            {['Date of birth', 'Gender', 'Emergency phone', 'Photo / KYC'].map((item) => (
              <div key={item} className="flex items-center gap-2 rounded-xl bg-muted/50 p-2.5 font-medium text-muted-foreground">
                <span className="h-2 w-2 rounded-full border border-muted-foreground/60" />
                {item}
              </div>
            ))}
          </div>
        </div>

        {/* 7. PRIVATE NOTES (OWNER ONLY) */}
        <div className="flex flex-col gap-3 rounded-[20px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="flex items-center gap-2">
            <StickyNote className="h-4 w-4 text-primary" strokeWidth={1.8} />
            <span className="font-display text-sm font-extrabold text-foreground">PRIVATE NOTES</span>
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-muted-foreground">OWNER ONLY</span>
          </div>
          <div className="flex items-center gap-2.5">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add an owner-private note…"
              className="min-w-0 flex-1 rounded-xl border border-border bg-muted/50 px-3.5 py-2.5 text-[12.5px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <button
              type="button"
              onClick={handleAddNote}
              aria-label="Add note"
              className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm active:scale-95 transition-transform"
            >
              <Plus className="h-4 w-4" strokeWidth={2.4} />
            </button>
          </div>

          <div className="flex flex-col gap-2">
            {notesList.map((n, i) => (
              <div key={i} className="rounded-xl bg-muted/40 p-2.5 text-[12px] font-medium leading-relaxed text-foreground">
                • {n}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sticky Bottom Contextual Action Bar */}
      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-border bg-card/95 p-3.5 backdrop-blur-md sm:mx-auto sm:max-w-[480px]">
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => setActionsOpen(true)}
            className="flex-1 rounded-2xl border border-border bg-card py-3.5 font-display text-[13.5px] font-bold text-foreground shadow-sm hover:bg-muted active:scale-[0.98] transition-transform"
          >
            Manage invitation
          </button>

          <button
            type="button"
            onClick={isReadyToActivate ? handleActivate : () => setEditInviteOpen(true)}
            disabled={isActivating}
            className={`flex-1 flex items-center justify-center gap-2 rounded-2xl py-3.5 font-display text-[13.5px] font-bold text-primary-foreground shadow-md active:scale-[0.98] transition-transform ${
              isReadyToActivate ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-primary'
            }`}
          >
            {isActivating ? (
              'Activating…'
            ) : isReadyToActivate ? (
              <>
                <CheckCircle2 className="h-4 w-4" strokeWidth={2.2} />
                Activate tenant
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" strokeWidth={2} />
                Complete setup ({missingItems.length})
              </>
            )}
          </button>
        </div>
      </div>

      {/* Sheets and Modals */}
      <InvitedTenantActionsSheet
        open={actionsOpen}
        onClose={() => setActionsOpen(false)}
        onEditTenant={() => setEditTenantOpen(true)}
        onEditStay={() => setEditInviteOpen(true)}
        onEditFinancials={() => setEditInviteOpen(true)}
        onResendInvitation={handleResend}
        onCopyLink={handleCopyLink}
        onCancelInvitation={() => setCancelModalOpen(true)}
      />

      <EditTenantModal
        open={editTenantOpen}
        onClose={() => setEditTenantOpen(false)}
        initialName={tenant.name}
        initialPhone={tenant.phone}
        onSave={handleSaveTenantDetails}
      />

      <CancelInvitationModal
        open={cancelModalOpen}
        onClose={() => setCancelModalOpen(false)}
        tenantName={tenant.name}
        onConfirm={handleConfirmCancel}
      />

      {editInviteOpen && (
        <EditInviteModal
          onClose={() => {
            setEditInviteOpen(false);
            queryClient.invalidateQueries({ queryKey: ['owner', 'tenant', tenant.id, 'detail'] });
          }}
          tenantId={tenant.id}
          hostelId={tenant.hostelId}
        />
      )}
    </div>
  );
}
