import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, User, BedDouble, Calendar, ChevronDown, ChevronRight, Copy, Check, IndianRupee, RotateCcw, Building2, AlertTriangle, ArrowRight } from 'lucide-react';
import { ownerService } from '@domains/hostels/api';
import { roomService } from '@domains/rooms/api';
import { tenantService } from '@domains/tenants/api';
import { queryKeys } from '@lib/queryKeys';
import { StayoLoader } from '@shared/ui/brand';

interface EditInviteModalProps {
  onClose: () => void;
  tenantId: string;
  hostelId: string;
}

type MtType = 'MONTHLY' | 'ONE_TIME' | 'NONE';

const fmt = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`;
const inp = 'w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-accent';

export function EditInviteModal({ onClose, tenantId, hostelId }: EditInviteModalProps) {
  const qc = useQueryClient();

  // 1. Fetch current tenant details for pre-filling
  const { data: tenant, isLoading: tenantLoading } = useQuery({
    queryKey: queryKeys.tenants.overview(hostelId, tenantId),
    queryFn: () => tenantService.getOwnerTenantOverview(tenantId),
    enabled: Boolean(tenantId && hostelId),
  });

  const invitationData = tenant?.tenant_invitations?.[0] || null;

  const [selectedHostelId, setSelectedHostelId] = useState(hostelId);
  const [name, setName]               = useState('');
  const [phone, setPhone]             = useState('');
  const [email, setEmail]             = useState('');
  const [roomId, setRoomId]           = useState('');
  const [currentRoomId, setCurrentRoomId] = useState('');
  const [currentRoomNo, setCurrentRoomNo] = useState('');
  const [loadedRoomId, setLoadedRoomId] = useState<string | null>(null);
  const [joiningDate, setJoiningDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [agreementStartDate, setAgreementStartDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [isStartDateOverridden, setIsStartDateOverridden] = useState(false);
  const [agreementDuration, setAgreementDuration] = useState('12');
  const [customDuration, setCustomDuration] = useState('');
  const [paymentFrequency, setPaymentFrequency] = useState('MONTHLY');
  const [monthlyRent, setMonthlyRent] = useState('');
  const [advanceDeposit, setAdvanceDeposit] = useState('');
  const [maintenanceCharge, setMaintenanceCharge] = useState('');
  const [maintenanceType, setMaintenanceType] = useState<MtType>('MONTHLY');
  const [isDepositManuallyEdited, setIsDepositManuallyEdited] = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [success, setSuccess]         = useState(false);
  const [link, setLink]               = useState('');
  const [copied, setCopied]           = useState(false);
  const [showComparison, setShowComparison] = useState(false);

  // New WhatsApp/Email fallback states
  const [whatsappSent, setWhatsappSent] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [needsEmail, setNeedsEmail] = useState(false);
  const [fallbackEmail, setFallbackEmail] = useState('');
  const [fallbackSubmitting, setFallbackSubmitting] = useState(false);

  const { data: hostelsRaw = [] } = useQuery({
    queryKey: queryKeys.owner.hostels(),
    queryFn: () => ownerService.getHostels(),
    staleTime: 5 * 60 * 1000,
  });

  const hostels = Array.isArray(hostelsRaw)
    ? hostelsRaw
    : Array.isArray((hostelsRaw as any)?.hostels)
      ? (hostelsRaw as any).hostels
      : [];

  // Populate form fields once tenant data is loaded
  useEffect(() => {
    if (tenant) {
      setName(tenant.name || invitationData?.name || '');
      setPhone(tenant.phone || invitationData?.phone || '');
      setEmail(tenant.email || invitationData?.email || '');
      
      const allocRoomId = tenant.current_room?.id || '';
      setRoomId(allocRoomId);
      setCurrentRoomId(allocRoomId);
      setCurrentRoomNo(tenant.current_room?.room_no || '');
      
      if (tenant.joined_on) {
        setJoiningDate(new Date(tenant.joined_on).toISOString().split('T')[0]);
      }
      
      const inviteStartDate = invitationData?.agreement_start_date;
      if (inviteStartDate) {
        setAgreementStartDate(new Date(inviteStartDate).toISOString().split('T')[0]);
        setIsStartDateOverridden(true);
      } else if (tenant.joined_on) {
        setAgreementStartDate(new Date(tenant.joined_on).toISOString().split('T')[0]);
      }
      
      const inviteDuration = invitationData?.agreement_duration_months;
      if (inviteDuration) {
        const isStandard = ['1', '3', '6', '9', '11', '12', '24'].includes(String(inviteDuration));
        if (isStandard) {
          setAgreementDuration(String(inviteDuration));
          setCustomDuration('');
        } else {
          setAgreementDuration('custom');
          setCustomDuration(String(inviteDuration));
        }
      }
      
      setPaymentFrequency(tenant.payment_frequency || 'MONTHLY');
      setMonthlyRent(String(tenant.monthly_rent || ''));
      setAdvanceDeposit(String(tenant.security_deposit || ''));
      setMaintenanceCharge(String(tenant.maintenance_charge || ''));
      setMaintenanceType((tenant.maintenance_type || 'NONE') as MtType);
      
      setLoadedRoomId(allocRoomId);
      setIsDepositManuallyEdited(true); // Don't overwrite loaded deposit with defaults unless user clears/resets
    }
  }, [tenant, invitationData]);

  // Sync agreement start date to joining date if not manually overridden
  useEffect(() => {
    if (!isStartDateOverridden) {
      setAgreementStartDate(joiningDate);
    }
  }, [joiningDate, isStartDateOverridden]);

  // ── Available rooms (ACTIVE + has free beds) ─────────────────────────────
  const { data: roomsRaw = [] } = useQuery({
    queryKey: queryKeys.rooms.list(selectedHostelId),
    queryFn: () => roomService.getAll(selectedHostelId),
    enabled: Boolean(selectedHostelId),
    staleTime: 2 * 60 * 1000,
  });
  const rooms: Record<string, any>[] = Array.isArray(roomsRaw) ? roomsRaw : [];
  
  // Filter available rooms, but always preserve the tenant's current room allocation
  const availableRooms = rooms.filter((r) => {
    if (r.id === currentRoomId) return true;
    const st = String(r.status ?? '').toUpperCase();
    if (st === 'MAINTENANCE' || st === 'BLOCKED') return false;
    return Number(r.occupied_count ?? 0) < Number(r.capacity ?? 1);
  });

  // ── Pricing defaults for selected room ───────────────────────────────────
  const { data: defaultsRaw, isFetching: pricingLoading } = useQuery({
    queryKey: ['invite-defaults', roomId],
    queryFn: () => roomService.getInviteDefaults(roomId),
    enabled: !!roomId && roomId !== currentRoomId,
    staleTime: 2 * 60 * 1000,
  });

  const responseRoomId = defaultsRaw?.data?.room?.id ?? defaultsRaw?.room?.id;
  const isCurrentRoom = responseRoomId === roomId;
  const rv: any = isCurrentRoom ? (defaultsRaw?.data?.resolved_values ?? defaultsRaw?.resolved_values ?? null) : null;
  const defaults = rv ? {
    monthly_rent:       Number(rv.monthly_rent ?? 0),
    advance_deposit:    Number(rv.advance_deposit ?? 0),
    maintenance_charge: Number(rv.maintenance_charge ?? 0),
    maintenance_type:   (rv.maintenance_type ?? 'MONTHLY') as MtType,
    deposit_calculation_mode: rv.deposit_calculation_mode as 'FLAT' | 'MONTHS_OF_RENT',
    deposit_months:     Number(rv.deposit_months ?? 1),
    agreement_duration_months: Number(rv.agreement_duration_months ?? 12),
  } : null;

  // Auto-fill defaults once when loadedRoomId does not match the current roomId
  useEffect(() => {
    if (!roomId) {
      setMonthlyRent('');
      setAdvanceDeposit('');
      setMaintenanceCharge('');
      setMaintenanceType('MONTHLY');
      setLoadedRoomId(null);
      setIsDepositManuallyEdited(false);
    } else if (defaults && roomId !== loadedRoomId) {
      setMonthlyRent(String(defaults.monthly_rent));
      setAdvanceDeposit(String(defaults.advance_deposit));
      setMaintenanceCharge(String(defaults.maintenance_charge));
      setMaintenanceType(defaults.maintenance_type);
      
      const defaultDuration = defaults.agreement_duration_months;
      const isStandard = ['1', '3', '6', '9', '11', '12', '24'].includes(String(defaultDuration));
      if (isStandard) {
        setAgreementDuration(String(defaultDuration));
        setCustomDuration('');
      } else {
        setAgreementDuration('custom');
        setCustomDuration(String(defaultDuration));
      }

      setLoadedRoomId(roomId);
      setIsDepositManuallyEdited(false);
    }
  }, [defaults, roomId, loadedRoomId]);

  const rentVal = Number(monthlyRent || 0);
  const depVal = Number(advanceDeposit || 0);
  const maintVal = Number(maintenanceCharge || 0);
  const totalDueAtMoveIn = rentVal + depVal + (maintenanceType === 'ONE_TIME' ? maintVal : 0);

  const handleRentChange = (val: string) => {
    setMonthlyRent(val);
    if (defaults && defaults.deposit_calculation_mode === 'MONTHS_OF_RENT' && !isDepositManuallyEdited) {
      const rentNum = Number(val || 0);
      setAdvanceDeposit(String(defaults.deposit_months * rentNum));
    }
  };

  const handleDepositChange = (val: string) => {
    setAdvanceDeposit(val);
    setIsDepositManuallyEdited(true);
  };

  const handleReset = () => {
    if (tenant) {
      setName(tenant.name || invitationData?.name || '');
      setPhone(tenant.phone || invitationData?.phone || '');
      setEmail(tenant.email || invitationData?.email || '');
      setRoomId(currentRoomId);
      setMonthlyRent(String(tenant.monthly_rent || ''));
      setAdvanceDeposit(String(tenant.security_deposit || ''));
      setMaintenanceCharge(String(tenant.maintenance_charge || ''));
      setMaintenanceType((tenant.maintenance_type || 'NONE') as MtType);
      
      const inviteDuration = invitationData?.agreement_duration_months;
      if (inviteDuration) {
        const isStandard = ['1', '3', '6', '9', '11', '12', '24'].includes(String(inviteDuration));
        if (isStandard) {
          setAgreementDuration(String(inviteDuration));
          setCustomDuration('');
        } else {
          setAgreementDuration('custom');
          setCustomDuration(String(inviteDuration));
        }
      }
      
      setIsDepositManuallyEdited(true);
      setLoadedRoomId(currentRoomId);
      setError(null);
    }
  };

  // ── Edit & Resend Mutation ────────────────────────────────────────────────
  const editMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => tenantService.update(tenantId, data),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: queryKeys.tenants.all(selectedHostelId) });
      qc.invalidateQueries({ queryKey: queryKeys.tenants.overview(selectedHostelId, tenantId) });
      qc.invalidateQueries({ queryKey: queryKeys.rooms.list(selectedHostelId) });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.all(selectedHostelId) });
      
      setLink(res?.activation_link ?? '');
      setWhatsappSent(res?.whatsapp_sent ?? false);
      setEmailSent(res?.email_sent ?? false);
      setNeedsEmail(res?.needs_email ?? false);
      setSuccess(true);
    },
    onError: (e: any) => {
      const msg =
        e?.response?.data?.error?.message ??
        e?.response?.data?.message ??
        e?.message ??
        'Failed to update and resend invitation';
      setError(msg);
    },
  });

  const originalValues = {
    name: tenant?.name || invitationData?.name || '',
    phone: tenant?.phone || invitationData?.phone || '',
    email: tenant?.email || invitationData?.email || '',
    roomId: tenant?.current_room?.id || '',
    roomNo: tenant?.current_room?.room_no || '',
    joiningDate: tenant?.joined_on ? new Date(tenant.joined_on).toISOString().split('T')[0] : '',
    billingFrequency: tenant?.payment_frequency || 'MONTHLY',
    monthlyRent: String(tenant?.monthly_rent || ''),
    advanceDeposit: String(tenant?.security_deposit || ''),
    maintenanceCharge: String(tenant?.maintenance_charge || ''),
    maintenanceType: tenant?.maintenance_type || 'NONE',
    agreementStartDate: invitationData?.agreement_start_date ? new Date(invitationData.agreement_start_date).toISOString().split('T')[0] : (tenant?.joined_on ? new Date(tenant.joined_on).toISOString().split('T')[0] : ''),
    agreementDuration: invitationData?.agreement_duration_months ? String(invitationData.agreement_duration_months) : '',
  };

  const confirmSubmit = () => {
    setError(null);
    editMutation.mutate({
      invitation_edit:    true,
      name:               name.trim(),
      phone:              phone.trim() || undefined,
      email:              email.trim().toLowerCase() || undefined,
      room_id:            roomId,
      joining_date:       joiningDate,
      payment_frequency:  paymentFrequency,
      monthly_rent:       monthlyRent ? Number(monthlyRent) : undefined,
      advance_amount:     advanceDeposit ? Number(advanceDeposit) : undefined,
      maintenance_amount: maintenanceCharge ? Number(maintenanceCharge) : undefined,
      maintenance_type:   maintenanceType,
      agreement_start_date: agreementStartDate || undefined,
      agreement_duration_months: agreementDuration === 'custom' ? Number(customDuration) : Number(agreementDuration),
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const finalDuration = agreementDuration === 'custom' ? customDuration : agreementDuration;
    const hasChanges =
      originalValues.name !== name.trim() ||
      originalValues.phone !== phone.trim() ||
      originalValues.email !== email.trim() ||
      originalValues.roomId !== roomId ||
      originalValues.joiningDate !== joiningDate ||
      originalValues.billingFrequency !== paymentFrequency ||
      Number(originalValues.monthlyRent) !== Number(monthlyRent) ||
      Number(originalValues.advanceDeposit) !== Number(advanceDeposit) ||
      Number(originalValues.maintenanceCharge) !== Number(maintenanceCharge) ||
      originalValues.maintenanceType !== maintenanceType ||
      originalValues.agreementStartDate !== agreementStartDate ||
      originalValues.agreementDuration !== finalDuration;

    if (hasChanges) {
      setShowComparison(true);
    } else {
      confirmSubmit();
    }
  };

  const handleFallbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFallbackSubmitting(true);
    try {
      const res = await tenantService.resendInvitation(phone.trim(), {
        email: fallbackEmail.trim().toLowerCase()
      });
      if (res?.email_sent) {
        setEmailSent(true);
        setNeedsEmail(false);
        setLink(res?.activation_link ?? link);
      } else {
        setError(res?.email_error || res?.message || 'Email delivery failed');
      }
    } catch (e: any) {
      const msg =
        e?.response?.data?.error?.message ??
        e?.response?.data?.message ??
        e?.message ??
        'Failed to send email fallback';
      setError(msg);
    } finally {
      setFallbackSubmitting(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (tenantLoading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-card rounded-2xl p-6 border border-border flex flex-col items-center gap-3">
          <StayoLoader size="lg" className="text-accent" />
          <p className="text-sm text-muted-foreground">Loading invitation details…</p>
        </div>
      </div>
    );
  }

  // ── Changes Detected comparison overlay ──────────────────────────────
  if (showComparison) {
    const changes: { label: string; from: string; to: string }[] = [];
    if (originalValues.name !== name.trim()) {
      changes.push({ label: 'Name', from: originalValues.name, to: name.trim() });
    }
    if (originalValues.phone !== phone.trim()) {
      changes.push({ label: 'Phone', from: originalValues.phone, to: phone.trim() });
    }
    if (originalValues.email !== email.trim()) {
      changes.push({ label: 'Email', from: originalValues.email || 'None', to: email.trim() || 'None' });
    }
    if (originalValues.roomId !== roomId) {
      const oldRoomNo = originalValues.roomNo || 'None';
      const newRoom = availableRooms.find(r => r.id === roomId);
      const newRoomNo = newRoom ? newRoom.room_no : 'None';
      changes.push({ label: 'Room', from: oldRoomNo, to: newRoomNo });
    }
    if (originalValues.joiningDate !== joiningDate) {
      changes.push({ label: 'Joining Date', from: originalValues.joiningDate, to: joiningDate });
    }
    if (originalValues.billingFrequency !== paymentFrequency) {
      changes.push({ label: 'Billing Frequency', from: originalValues.billingFrequency, to: paymentFrequency });
    }
    if (Number(originalValues.monthlyRent) !== Number(monthlyRent)) {
      changes.push({ label: 'Rent', from: fmt(Number(originalValues.monthlyRent || 0)), to: fmt(Number(monthlyRent || 0)) });
    }
    if (Number(originalValues.advanceDeposit) !== Number(advanceDeposit)) {
      changes.push({ label: 'Deposit', from: fmt(Number(originalValues.advanceDeposit || 0)), to: fmt(Number(advanceDeposit || 0)) });
    }
    const oldMaintLabel = originalValues.maintenanceType === 'NONE' ? 'None' : `${fmt(Number(originalValues.maintenanceCharge || 0))} (${originalValues.maintenanceType})`;
    const newMaintLabel = maintenanceType === 'NONE' ? 'None' : `${fmt(Number(maintenanceCharge || 0))} (${maintenanceType})`;
    if (oldMaintLabel !== newMaintLabel) {
      changes.push({ label: 'Maintenance', from: oldMaintLabel, to: newMaintLabel });
    }
    if (originalValues.agreementStartDate !== agreementStartDate) {
      changes.push({ label: 'Agreement Start Date', from: originalValues.agreementStartDate, to: agreementStartDate });
    }
    const finalDuration = agreementDuration === 'custom' ? customDuration : agreementDuration;
    if (originalValues.agreementDuration !== finalDuration) {
      changes.push({ label: 'Agreement Duration', from: originalValues.agreementDuration ? `${originalValues.agreementDuration} months` : 'None', to: finalDuration ? `${finalDuration} months` : 'None' });
    }

    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
        <div className="w-full max-w-lg bg-card rounded-t-2xl md:rounded-2xl border border-border max-h-[90dvh] overflow-y-auto shadow-2xl p-6 transition-all" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-col gap-5">
            <div>
              <h3 className="font-bold text-foreground text-lg flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                Changes Detected
              </h3>
              <p className="text-xs text-muted-foreground mt-1">Please review the proposed contract modifications before sending the updated invitation.</p>
            </div>

            {changes.length === 0 ? (
              <div className="p-4 bg-secondary/30 rounded-xl border border-border text-center text-xs text-muted-foreground">
                No differences detected. The invitation will be resent with its current parameters.
              </div>
            ) : (
              <div className="border border-border rounded-xl overflow-hidden divide-y divide-border bg-secondary/10">
                {changes.map((chg, idx) => (
                  <div key={idx} className="grid grid-cols-3 gap-2 px-4 py-3 text-xs items-center">
                    <span className="font-semibold text-muted-foreground">{chg.label}</span>
                    <span className="text-rose-500 line-through truncate pr-2">{chg.from || '—'}</span>
                    <span className="text-emerald-600 font-bold flex items-center gap-1.5 min-w-0">
                      <ArrowRight className="w-3 h-3 shrink-0 text-emerald-500/70" />
                      <span className="truncate">{chg.to || '—'}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowComparison(false)}
                className="flex-1 py-3 border border-border text-foreground hover:bg-secondary rounded-xl text-sm font-semibold transition-colors active:scale-[0.98]"
              >
                Back to Edit
              </button>
              <button
                type="button"
                onClick={confirmSubmit}
                disabled={editMutation.isPending}
                className="flex-1 py-3 bg-accent text-accent-foreground rounded-xl text-sm font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-2"
              >
                {editMutation.isPending ? (
                  <><StayoLoader size="sm" label={null} /> Saving &amp; Resending…</>
                ) : (
                  'Confirm &amp; Resend'
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Success / Fallback state ──────────────────────────────────────────────
  if (success) {
    if (needsEmail) {
      return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
          <div className="w-full max-w-lg bg-card rounded-t-2xl md:rounded-2xl border border-border p-6 shadow-2xl transition-all" onClick={(e) => e.stopPropagation()}>
            <div className="flex flex-col gap-4 py-4">
              <div className="flex flex-col items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center">
                  <X className="w-6 h-6 text-amber-500" />
                </div>
                <h3 className="font-semibold text-foreground text-center">WhatsApp Delivery Failed</h3>
                <p className="text-xs text-muted-foreground text-center max-w-[280px]">
                  WhatsApp delivery failed. Please enter the tenant's email address to send the invitation via email fallback.
                </p>
              </div>

              {error && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-xl">
                  <p className="text-xs text-destructive">{error}</p>
                </div>
              )}

              <form onSubmit={handleFallbackSubmit} className="space-y-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Email Address *</label>
                  <input
                    type="email"
                    value={fallbackEmail}
                    onChange={(e) => setFallbackEmail(e.target.value)}
                    required
                    placeholder="tenant@email.com"
                    className={inp}
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="flex-1 py-3 border border-border text-foreground rounded-xl text-sm font-semibold active:scale-[0.98]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={fallbackSubmitting || !fallbackEmail.trim()}
                    className="flex-1 py-3 bg-accent text-accent-foreground rounded-xl text-sm font-semibold active:scale-[0.98] flex items-center justify-center gap-2"
                  >
                    {fallbackSubmitting ? (
                      <><StayoLoader size="sm" label={null} /> Sending fallback…</>
                    ) : (
                      'Send via Email'
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
        <div className="w-full max-w-lg bg-card rounded-t-2xl md:rounded-2xl border border-border p-6 shadow-2xl transition-all" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="w-12 h-12 rounded-full bg-[#10B981]/10 flex items-center justify-center">
              <Check className="w-6 h-6 text-[#10B981]" />
            </div>
            <h3 className="font-semibold text-foreground">
              {whatsappSent
                ? 'Sent via WhatsApp!'
                : emailSent
                ? 'Sent via Email!'
                : 'Invitation Updated!'}
            </h3>
            <p className="text-xs text-muted-foreground text-center max-w-[280px]">
              {whatsappSent
                ? `Invitation successfully updated and sent to tenant's WhatsApp number (+91 ${phone}).`
                : emailSent
                ? `Invitation successfully updated and sent to tenant's email address (${email || fallbackEmail}).`
                : 'The invitation was updated but delivery failed. You can copy the activation link below to share it manually.'}
            </p>
            {link && (
              <div className="w-full flex items-center gap-2 px-3 py-2.5 bg-secondary rounded-xl mt-1">
                <span className="flex-1 text-[11px] text-muted-foreground truncate font-mono">{link}</span>
                <button type="button" onClick={copyLink} className="shrink-0 text-muted-foreground active:scale-90 p-1">
                  {copied ? <Check className="w-4 h-4 text-[#10B981]" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
            )}
            <button onClick={onClose} className="w-full py-3 bg-accent text-accent-foreground rounded-xl text-sm font-semibold mt-2 active:scale-[0.98]">
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main Form View ────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-card rounded-t-2xl md:rounded-2xl border border-border max-h-[90dvh] overflow-y-auto shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-6 pt-5 pb-4 flex items-center justify-between z-10">
          <div>
            <h2 className="font-semibold text-foreground text-base">Edit & Resend Invitation</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">Modifying this will expire the previous invitation token.</p>
          </div>
          <button onClick={onClose} className="p-1.5 text-muted-foreground hover:text-foreground rounded-full hover:bg-secondary transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-6">
          {error && (
            <div className="flex items-center justify-between gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-xl">
              <span className="text-xs text-destructive">{error}</span>
              <button type="button" onClick={() => setError(null)} className="shrink-0 text-destructive">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* ── Section 1: Tenant Details ───────────────────────────── */}
          <div>
            <SectionHeader icon={<User className="w-3.5 h-3.5" />} label="Tenant Details" />
            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Full Name *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} required
                  placeholder="Rahul Sharma" className={inp} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Phone *</label>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required
                    placeholder="+91 98765…" className={inp} />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Email (optional)</label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="tenant@email.com" className={inp} />
                </div>
              </div>
            </div>
          </div>

          {/* ── Section 2: Stay Details ─────────────────────────────── */}
          <div>
            <SectionHeader icon={<BedDouble className="w-3.5 h-3.5" />} label="Stay & Room Details" />
            <div className="space-y-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  <span className="flex items-center gap-1.5"><Building2 className="w-3 h-3" /> Hostel *</span>
                </label>
                <select
                  value={selectedHostelId}
                  onChange={(e) => {
                    setSelectedHostelId(e.target.value);
                    setRoomId('');
                    setMonthlyRent('');
                    setAdvanceDeposit('');
                    setMaintenanceCharge('');
                    setMaintenanceType('MONTHLY');
                    setLoadedRoomId(null);
                  }}
                  required
                  className={inp}
                >
                  <option value="">Select a hostel…</option>
                  {hostels.map((h: any) => (
                    <option key={String(h.id ?? h.hostel_id)} value={String(h.id ?? h.hostel_id)}>
                      {String(h.name ?? h.hostel_name ?? 'Hostel')}
                      {h.city ? ` · ${String(h.city)}` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Room *</label>
                <select
                  value={roomId}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRoomId(val);
                    setMonthlyRent('');
                    setAdvanceDeposit('');
                    setMaintenanceCharge('');
                    setMaintenanceType('MONTHLY');
                    setLoadedRoomId(null);
                  }}
                  required
                  disabled={!selectedHostelId}
                  className={inp}
                >
                  <option value="">{selectedHostelId ? 'Select a room…' : 'Select a hostel first…'}</option>
                  {availableRooms.map((r) => {
                    const occ   = Number(r.occupied_count ?? 0);
                    const cap   = Number(r.capacity ?? 1);
                    const isCurrent = r.id === currentRoomId;
                    const labelSuffix = isCurrent ? ' (Current Room)' : ` · ${occ}/${cap} occupied`;
                    const floor = r.floor_name ? ` · ${r.floor_name}` : '';
                    return (
                      <option key={String(r.id)} value={String(r.id)}>
                        {String(r.room_no)}{floor}{labelSuffix}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">
                  <span className="flex items-center gap-1.5"><Calendar className="w-3 h-3" /> Joining Date *</span>
                </label>
                <input type="date" value={joiningDate} onChange={(e) => setJoiningDate(e.target.value)} required className={inp} />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Billing Frequency *</label>
                <select
                  value={paymentFrequency}
                  onChange={(e) => setPaymentFrequency(e.target.value)}
                  required
                  className={inp}
                >
                  <option value="MONTHLY">Monthly</option>
                  <option value="QUARTERLY">Quarterly</option>
                  <option value="HALF_YEARLY">Half Yearly</option>
                  <option value="ACADEMIC_YEARLY">Academic Yearly</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── Section 3: Financial Details ────────────────────────── */}
          <div>
            <SectionHeader icon={<IndianRupee className="w-3.5 h-3.5" />} label="Financial Details" />
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Monthly Rent (₹) *</label>
                  <input
                    type="number"
                    value={monthlyRent}
                    onChange={(e) => handleRentChange(e.target.value)}
                    required
                    min="0"
                    placeholder="e.g. 8500"
                    className={inp}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block flex items-center justify-between">
                    <span>Security Deposit (₹) *</span>
                    {isDepositManuallyEdited && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsDepositManuallyEdited(false);
                          if (defaults) {
                            if (defaults.deposit_calculation_mode === 'MONTHS_OF_RENT') {
                              setAdvanceDeposit(String(defaults.deposit_months * rentVal));
                            } else {
                              setAdvanceDeposit(String(defaults.advance_deposit));
                            }
                          } else {
                            // Scale defaults to 2x rent as safety fallback
                            setAdvanceDeposit(String(2 * rentVal));
                          }
                        }}
                        className="text-[10px] text-accent flex items-center gap-0.5 font-medium hover:underline"
                      >
                        <RotateCcw className="w-2.5 h-2.5" /> Auto
                      </button>
                    )}
                  </label>
                  <input
                    type="number"
                    value={advanceDeposit}
                    onChange={(e) => handleDepositChange(e.target.value)}
                    required
                    min="0"
                    placeholder="e.g. 17000"
                    className={inp}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Maintenance Charge (₹)</label>
                  <input
                    type="number"
                    value={maintenanceCharge}
                    onChange={(e) => setMaintenanceCharge(e.target.value)}
                    min="0"
                    placeholder="e.g. 1000"
                    className={inp}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Maintenance Type</label>
                  <select
                    value={maintenanceType}
                    onChange={(e) => setMaintenanceType(e.target.value as MtType)}
                    className={inp}
                  >
                    <option value="NONE">None</option>
                    <option value="MONTHLY">Monthly</option>
                    <option value="ONE_TIME">One-time</option>
                  </select>
                </div>
              </div>

              {/* Total Summary */}
              {roomId && (
                <div className="p-3 bg-secondary/30 border border-border rounded-xl flex items-center justify-between text-xs">
                  <span className="text-muted-foreground font-medium">Estimated Move-in Cost:</span>
                  <span className="font-bold text-foreground">{fmt(totalDueAtMoveIn)}</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Section 4: Agreement Details ────────────────────────── */}
          <div>
            <SectionHeader icon={<Calendar className="w-3.5 h-3.5" />} label="Agreement Details" />
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Agreement Start Date *</label>
                  <input
                    type="date"
                    value={agreementStartDate}
                    onChange={(e) => {
                      setAgreementStartDate(e.target.value);
                      setIsStartDateOverridden(true);
                    }}
                    required
                    className={inp}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Agreement Duration *</label>
                  <select
                    value={agreementDuration}
                    onChange={(e) => setAgreementDuration(e.target.value)}
                    required
                    className={inp}
                  >
                    <option value="1">1 Month</option>
                    <option value="3">3 Months</option>
                    <option value="6">6 Months</option>
                    <option value="9">9 Months</option>
                    <option value="11">11 Months</option>
                    <option value="12">12 Months (1 Year)</option>
                    <option value="24">24 Months (2 Years)</option>
                    <option value="custom">Custom duration…</option>
                  </select>
                </div>
              </div>

              {agreementDuration === 'custom' && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Custom Duration (months) *</label>
                  <input
                    type="number"
                    value={customDuration}
                    onChange={(e) => setCustomDuration(e.target.value)}
                    required
                    min="1"
                    max="120"
                    placeholder="e.g. 18"
                    className={inp}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-4 pt-4 border-t border-border">
            <button
              type="button"
              onClick={handleReset}
              className="px-4 py-3 border border-border text-foreground hover:bg-secondary rounded-xl text-sm font-semibold transition-colors"
            >
              Reset
            </button>
            <button
              type="submit"
              disabled={editMutation.isPending || pricingLoading}
              className="flex-1 py-3 bg-accent text-accent-foreground disabled:opacity-50 rounded-xl text-sm font-semibold active:scale-[0.98] transition-all flex items-center justify-center gap-2"
            >
              {editMutation.isPending ? (
                <><StayoLoader size="sm" label={null} /> Saving & Resending…</>
              ) : (
                'Save & Resend Invitation'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="text-accent">{icon}</div>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</h3>
    </div>
  );
}
