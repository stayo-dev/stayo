import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { X, User, UserCheck, BedDouble, Calendar, ChevronDown, ChevronRight, Copy, Check, Loader2, IndianRupee, RotateCcw, Building2 } from 'lucide-react';
import { ownerService } from '@domains/hostels/api';
import { roomService } from '@domains/rooms/api';
import { tenantService } from '@domains/tenants/api';
import { parseTenancyConflict, type TenancyConflict } from '@/features/tenants/tenancyConflict';
import { queryKeys } from '@lib/queryKeys';

interface AddTenantModalProps {
  onClose: () => void;
  hostelId?: string;
  preselectedRoomId?: string;
}

type MtType = 'MONTHLY' | 'ONE_TIME' | 'NONE';
type Overrides = { monthly_rent?: number; advance_deposit?: number; maintenance_charge?: number };

const fmt = (n: number) => `₹${Number(n).toLocaleString('en-IN')}`;
const inp = 'w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-accent';

export function AddTenantModal({ onClose, hostelId, preselectedRoomId }: AddTenantModalProps) {
  const qc = useQueryClient();

  const [selectedHostelId, setSelectedHostelId] = useState(hostelId ?? '');
  const [name, setName]               = useState('');
  const [phone, setPhone]             = useState('');
  const [email, setEmail]             = useState('');
  const [roomId, setRoomId]           = useState(preselectedRoomId ?? '');
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
  const [conflict, setConflict]       = useState<TenancyConflict | null>(null);
  const [success, setSuccess]         = useState(false);
  const [link, setLink]               = useState('');
  const [copied, setCopied]           = useState(false);

  // New WhatsApp/Email fallback states
  const [whatsappSent, setWhatsappSent] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [needsEmail, setNeedsEmail] = useState(false);
  const [invitedTenantId, setInvitedTenantId] = useState('');
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

  useEffect(() => {
    if (!selectedHostelId && hostels.length > 0) {
      setSelectedHostelId(String(hostels[0].id ?? hostels[0].hostel_id));
    }
  }, [hostels, selectedHostelId]);

  useEffect(() => {
    const selectedHostel = hostels.find((h: any) => String(h.id ?? h.hostel_id) === selectedHostelId);
    if (selectedHostel?.rent_cycle) {
      setPaymentFrequency(selectedHostel.rent_cycle);
    } else {
      setPaymentFrequency('MONTHLY');
    }
  }, [selectedHostelId, hostels]);

  useEffect(() => {
    if (hostelId) setSelectedHostelId(hostelId);
  }, [hostelId]);

  useEffect(() => {
    if (preselectedRoomId) {
      setRoomId(preselectedRoomId);
      setMonthlyRent('');
      setAdvanceDeposit('');
      setMaintenanceCharge('');
      setMaintenanceType('MONTHLY');
      setLoadedRoomId(null);
    }
  }, [preselectedRoomId]);

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
  const availableRooms = rooms.filter((r) => {
    const st = String(r.status ?? '').toUpperCase();
    if (st === 'MAINTENANCE' || st === 'BLOCKED') return false;
    return Number(r.occupied_count ?? 0) < Number(r.capacity ?? 1);
  });

  // ── Pricing defaults for selected room ───────────────────────────────────
  const { data: defaultsRaw, isFetching: pricingLoading } = useQuery({
    queryKey: ['invite-defaults', roomId],
    queryFn: () => roomService.getInviteDefaults(roomId),
    enabled: !!roomId,
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

  const isDirty = defaults && (
    Number(monthlyRent) !== defaults.monthly_rent ||
    Number(advanceDeposit) !== defaults.advance_deposit ||
    Number(maintenanceCharge) !== defaults.maintenance_charge ||
    maintenanceType !== defaults.maintenance_type
  );

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
    if (defaults) {
      setMonthlyRent(String(defaults.monthly_rent));
      setMaintenanceCharge(String(defaults.maintenance_charge));
      setMaintenanceType(defaults.maintenance_type);
      setIsDepositManuallyEdited(false);
      
      const rentNum = defaults.monthly_rent;
      const expectedDep = defaults.deposit_calculation_mode === 'MONTHS_OF_RENT'
        ? defaults.deposit_months * rentNum
        : defaults.advance_deposit;
      setAdvanceDeposit(String(expectedDep));
    }
  };

  // ── Invite mutation ───────────────────────────────────────────────────────
  const inviteMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => tenantService.invite(data),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: queryKeys.tenants.all(selectedHostelId) });
      qc.invalidateQueries({ queryKey: queryKeys.rooms.list(selectedHostelId) });
      qc.invalidateQueries({ queryKey: queryKeys.dashboard.all(selectedHostelId) });
      qc.invalidateQueries({ queryKey: queryKeys.portfolio.performance(6) });
      setLink(res?.activation_link ?? '');
      setWhatsappSent(res?.whatsapp_sent ?? false);
      setEmailSent(res?.email_sent ?? false);
      setNeedsEmail(res?.needs_email ?? false);
      setInvitedTenantId(res?.tenant_id ?? '');
      setSuccess(true);
    },
    onError: (e: any) => {
      // "Already a tenant somewhere" is not a form validation failure — it needs an
      // explanation and a next step, not a red line above the fields.
      const tenancyConflict = parseTenancyConflict(e);
      if (tenancyConflict) {
        setConflict(tenancyConflict);
        return;
      }
      const msg =
        e?.response?.data?.error?.message ??
        e?.response?.data?.message ??
        e?.message ??
        'Failed to send invitation';
      setError(msg);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setConflict(null);
    inviteMutation.mutate({
      name:               name.trim(),
      phone:              phone.trim() || undefined,
      email:              email.trim().toLowerCase() || undefined,
      hostel_id:          selectedHostelId,
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

  // ── Success / Fallback state ──────────────────────────────────────────────
  if (success) {
    if (needsEmail) {
      return (
        <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
          <div className="w-full bg-card rounded-t-2xl border-t border-border p-5" onClick={(e) => e.stopPropagation()}>
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
                      <><Loader2 className="w-4 h-4 animate-spin" /> Sending fallback…</>
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
      <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
        <div className="w-full bg-card rounded-t-2xl border-t border-border p-5" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-col items-center gap-3 py-4">
            <div className="w-12 h-12 rounded-full bg-[#10B981]/10 flex items-center justify-center">
              <Check className="w-6 h-6 text-[#10B981]" />
            </div>
            <h3 className="font-semibold text-foreground">
              {whatsappSent
                ? 'Sent via WhatsApp!'
                : emailSent
                ? 'Sent via Email!'
                : 'Invitation Created!'}
            </h3>
            <p className="text-xs text-muted-foreground text-center max-w-[280px]">
              {whatsappSent
                ? `Invitation successfully sent to tenant's WhatsApp number (+91 ${phone}).`
                : emailSent
                ? `Invitation successfully sent to tenant's email address (${email || fallbackEmail}).`
                : 'The invitation was created but delivery failed. You can copy the activation link below to share it manually.'}
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

  // ── Already-a-tenant dialog ───────────────────────────────────────────────
  // Shown instead of the form's error banner: this is an outcome the owner needs
  // explained, not a field they can correct.
  if (conflict) {
    return (
      <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
        <div
          className="w-full bg-card rounded-t-2xl border-t border-border px-4 pt-6 pb-10 space-y-4"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center shrink-0">
              <UserCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-bold text-foreground">{conflict.title}</h2>
              <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{conflict.body}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setConflict(null)}
              className="flex-1 py-3 rounded-xl border border-border bg-background text-sm font-semibold text-foreground active:scale-[0.98] transition-transform"
            >
              Back
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 rounded-xl bg-[#243A72] text-white text-sm font-semibold active:scale-[0.98] transition-transform"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Main form ─────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-end" onClick={onClose}>
      <div
        className="w-full bg-card rounded-t-2xl border-t border-border max-h-[92dvh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-card border-b border-border px-4 pt-4 pb-3 flex items-center justify-between z-10">
          <h2 className="font-semibold text-foreground text-sm">Invite Tenant</h2>
          <button onClick={onClose} className="p-1.5 text-muted-foreground active:scale-90">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-4 pt-4 pb-10 space-y-5">
          {/* Error banner */}
          {error && (
            <div className="flex items-center justify-between gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-xl">
              <span className="text-xs text-destructive">{error}</span>
              <button type="button" onClick={() => setError(null)} className="shrink-0 text-destructive">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {/* ── Section 1: Tenant ─────────────────────────────────── */}
          <div>
            <SectionHeader icon={<User className="w-3.5 h-3.5" />} label="Tenant Details" />
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Full Name *</label>
                <input value={name} onChange={(e) => setName(e.target.value)} required
                  placeholder="e.g. Rahul Sharma" className={inp} />
              </div>
              <div className="grid grid-cols-2 gap-3">
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

          {/* ── Section 2: Stay ───────────────────────────────────── */}
          <div>
            <SectionHeader icon={<BedDouble className="w-3.5 h-3.5" />} label="Stay Details" />
            <div className="space-y-3">
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
                    const floor = r.floor_name ? ` · ${r.floor_name}` : '';
                    return (
                      <option key={String(r.id)} value={String(r.id)}>
                        {String(r.room_no)}{floor} · {occ}/{cap} occupied
                      </option>
                    );
                  })}
                </select>
                {availableRooms.length === 0 && rooms.length > 0 && (
                  <p className="text-[11px] text-amber-500 mt-1">All rooms are fully occupied or unavailable.</p>
                )}
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    <span className="flex items-center gap-1.5"><Calendar className="w-3.5 h-3.5" /> Agreement Start *</span>
                  </label>
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
                    <option value="custom">Custom...</option>
                  </select>
                </div>
              </div>
              {agreementDuration === 'custom' && (
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Custom Duration (Months) *</label>
                  <input
                    type="number"
                    min={1}
                    max={120}
                    value={customDuration}
                    onChange={(e) => setCustomDuration(e.target.value)}
                    required
                    placeholder="e.g. 18"
                    className={inp}
                  />
                </div>
              )}
            </div>
          </div>

          {/* ── Section 3: Pricing & Financials ────────────────────── */}
          {roomId && (
            <div className={`space-y-4 transition-opacity ${pricingLoading ? 'opacity-60' : ''}`}>
              <div className="flex items-center justify-between">
                <SectionHeader icon={<IndianRupee className="w-3.5 h-3.5" />} label="Pricing & Financials" />
                {isDirty && (
                  <button type="button" onClick={handleReset}
                    className="flex items-center gap-1 text-[10px] text-accent active:scale-95 font-medium mb-3">
                    <RotateCcw className="w-2.5 h-2.5" /> Reset to defaults
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Monthly Rent (₹) *</label>
                  <input
                    type="number"
                    min={0}
                    value={monthlyRent}
                    onChange={(e) => handleRentChange(e.target.value)}
                    required
                    placeholder="0"
                    className={inp}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs text-muted-foreground block">Security Deposit (₹) *</label>
                    {defaults?.deposit_calculation_mode === 'MONTHS_OF_RENT' && (
                      isDepositManuallyEdited ? (
                        <span className="text-[10px] text-amber-500 font-medium flex items-center gap-1">
                          Manual Override
                          <button
                            type="button"
                            onClick={() => {
                              setIsDepositManuallyEdited(false);
                              if (defaults) {
                                const expected = defaults.deposit_months * Number(monthlyRent || 0);
                                setAdvanceDeposit(String(expected));
                              }
                            }}
                            className="text-accent underline hover:text-accent/80 active:scale-95 ml-1"
                          >
                            Reset
                          </button>
                        </span>
                      ) : (
                        <span className="text-[10px] text-green-500 font-medium">
                          System Calculated
                        </span>
                      )
                    )}
                  </div>
                  <input
                    type="number"
                    min={0}
                    value={advanceDeposit}
                    onChange={(e) => handleDepositChange(e.target.value)}
                    required
                    placeholder="0"
                    className={inp}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Maintenance (₹)</label>
                  <input
                    type="number"
                    min={0}
                    value={maintenanceCharge}
                    onChange={(e) => setMaintenanceCharge(e.target.value)}
                    placeholder="0"
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
                    <option value="MONTHLY">Monthly</option>
                    <option value="ONE_TIME">One Time</option>
                    <option value="NONE">Waived (None)</option>
                  </select>
                </div>
              </div>

              {/* Summary card */}
              <div className="rounded-xl border border-border bg-secondary/40 p-3.5">
                <div className="space-y-2">
                  <PricingRow label="Monthly Rent" value={rentVal} />
                  <PricingRow
                    label="Maintenance"
                    value={maintVal}
                    sub={
                      maintenanceType === 'MONTHLY' ? '/mo'
                      : maintenanceType === 'ONE_TIME' ? ' one-time'
                      : ' (waived)'
                    }
                  />
                  <PricingRow label="Security Deposit" value={depVal} />
                  <div className="border-t border-border/60 pt-2 mt-1">
                    <PricingRow label="Total due at move-in" value={totalDueAtMoveIn} bold />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={inviteMutation.isPending || !selectedHostelId || !roomId || !name.trim() || !phone.trim()}
            className="w-full py-3 bg-accent text-accent-foreground rounded-xl text-sm font-semibold active:scale-[0.98] transition-transform disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {inviteMutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending invite…</>
              : 'Send Invitation'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function SectionHeader({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</span>
    </div>
  );
}

function PricingRow({ label, value, sub = '', bold = false }: { label: string; value: number; sub?: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={`text-xs ${bold ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>{label}</span>
      <span className={`text-xs ${bold ? 'font-semibold text-foreground' : 'text-foreground'}`}>
        {fmt(value)}{sub}
      </span>
    </div>
  );
}

// OverrideInput removed since pricing overrides are now primary input fields.
