import { useState, useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  User, FileText, IndianRupee, BedDouble, ArrowLeft,
  CheckCircle2, Clock, AlertCircle,
} from 'lucide-react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/app/components/ui/sheet';
import { useIsMobile } from '@/app/components/ui/use-mobile';
import { tenantService } from '@/features/tenants/api';
import { ChangePreview, type ChangeField } from './ChangePreview';
import { changeRequestKeys } from '../hooks/useChangeRequests';
import { StayoLoader } from '@shared/ui/brand';

// ─── Types ─────────────────────────────────────────────────────────

type DrawerStep = 'intent' | 'form' | 'summary' | 'result';

type ChangeIntent = 'personal' | 'agreement' | 'financial' | 'room';

interface IntentOption {
  id: ChangeIntent;
  label: string;
  description: string;
  icon: typeof User;
}

interface FieldConfig {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'select';
  format?: (v: any) => string;
  options?: { value: string; label: string }[];
}

interface ChangeRequestDrawerProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  hostelId: string;
  tenantData: Record<string, any>;
  onSuccess?: () => void;
}

// ─── Intent Options ────────────────────────────────────────────────

const INTENT_OPTIONS: IntentOption[] = [
  {
    id: 'personal',
    label: 'Change Personal Information',
    description: 'Name, phone, email, guardian details',
    icon: User,
  },
  {
    id: 'agreement',
    label: 'Amend Agreement',
    description: 'Rent, duration, payment terms',
    icon: FileText,
  },
  {
    id: 'financial',
    label: 'Correct Financial Data',
    description: 'Deposit, maintenance charges',
    icon: IndianRupee,
  },
  {
    id: 'room',
    label: 'Transfer Room',
    description: 'Move to a different room',
    icon: BedDouble,
  },
];

// ─── Field Configurations ─────────────────────────────────────────

const money = (v: any) => v ? `₹${Number(v).toLocaleString('en-IN')}` : '—';
const dateStr = (v: any) => v ? new Date(String(v)).toLocaleDateString('en-IN') : '—';

const INTENT_FIELDS: Record<ChangeIntent, FieldConfig[]> = {
  personal: [
    { key: 'name', label: 'Full Name', type: 'text' },
    { key: 'phone_1', label: 'Phone Number', type: 'text' },
    { key: 'email', label: 'Email Address', type: 'text' },
    { key: 'guardian_name', label: 'Guardian Name', type: 'text' },
    { key: 'guardian_phone', label: 'Guardian Phone', type: 'text' },
    { key: 'college_name', label: 'College Name', type: 'text' },
  ],
  agreement: [
    { key: 'monthly_rent', label: 'Monthly Rent', type: 'number', format: money },
    { key: 'agreement_duration_months', label: 'Agreement Duration (months)', type: 'number' },
    { key: 'agreement_start_date', label: 'Agreement Start Date', type: 'date', format: dateStr },
  ],
  financial: [
    { key: 'security_deposit', label: 'Security Deposit', type: 'number', format: money },
    { key: 'maintenance_charge', label: 'Maintenance Charge', type: 'number', format: money },
  ],
  room: [
    { key: 'room_id', label: 'Room', type: 'text' },
  ],
};

// ─── Helper: extract current value from tenant data ───────────────

function getCurrentValue(tenantData: Record<string, any>, key: string): any {
  // Try direct fields, then nested profile, then overview
  const profile = tenantData.profile ?? tenantData.profiles ?? {};
  const tenant = tenantData.tenant ?? tenantData;
  return tenant[key] ?? profile[key] ?? tenantData[key] ?? null;
}

// ─── Component ────────────────────────────────────────────────────

export function ChangeRequestDrawer({
  open,
  onClose,
  tenantId,
  hostelId,
  tenantData,
  onSuccess,
}: ChangeRequestDrawerProps) {
  const isMobile = useIsMobile();
  const queryClient = useQueryClient();

  // State machine
  const [step, setStep] = useState<DrawerStep>('intent');
  const [selectedIntent, setSelectedIntent] = useState<ChangeIntent | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [resultData, setResultData] = useState<{ applied: boolean; message: string } | null>(null);

  // Reset state on close
  const handleClose = () => {
    setStep('intent');
    setSelectedIntent(null);
    setFormValues({});
    setReason('');
    setResultData(null);
    onClose();
  };

  // Mutation
  const submitMutation = useMutation({
    mutationFn: async () => {
      // Build the payload with only changed fields
      const changes: Record<string, any> = {};
      const fields = selectedIntent ? INTENT_FIELDS[selectedIntent] : [];

      for (const field of fields) {
        const newValue = formValues[field.key]?.trim();
        if (!newValue) continue;

        const currentValue = String(getCurrentValue(tenantData, field.key) ?? '');
        if (newValue !== currentValue) {
          changes[field.key] = field.type === 'number' ? Number(newValue) : newValue;
        }
      }

      if (Object.keys(changes).length === 0) {
        throw new Error('No changes detected. Please modify at least one field.');
      }

      // Call the existing tenant update API which routes through the facade
      return tenantService.update(tenantId, {
        ...changes,
        reason,
        hostelId,
      });
    },
    onSuccess: (data: any) => {
      const applied = data?.applied !== false;
      const message = applied
        ? 'Changes applied successfully.'
        : 'Change request submitted. Waiting for tenant approval.';

      setResultData({ applied, message });
      setStep('result');

      // Invalidate change request queries
      queryClient.invalidateQueries({ queryKey: changeRequestKeys.all() });
      onSuccess?.();
    },
    onError: (error: any) => {
      const message =
        error?.response?.data?.error?.message ||
        error?.message ||
        'Failed to submit change request.';
      toast.error(message);
    },
  });

  // Compute the changed fields for the summary step
  const changedFields = useMemo<ChangeField[]>(() => {
    if (!selectedIntent) return [];
    const fields = INTENT_FIELDS[selectedIntent];

    return fields
      .filter((f) => {
        const newVal = formValues[f.key]?.trim();
        if (!newVal) return false;
        const currentVal = String(getCurrentValue(tenantData, f.key) ?? '');
        return newVal !== currentVal;
      })
      .map((f) => {
        const currentRaw = getCurrentValue(tenantData, f.key);
        const proposedRaw = formValues[f.key]?.trim();
        const format = f.format || ((v: any) => String(v ?? '—'));

        return {
          label: f.label,
          current: currentRaw != null ? format(currentRaw) : null,
          proposed: proposedRaw ? format(f.type === 'number' ? Number(proposedRaw) : proposedRaw) : null,
        };
      });
  }, [selectedIntent, formValues, tenantData]);

  const canSubmit = changedFields.length > 0 && reason.trim().length > 0;

  // ─── Render Steps ─────────────────────────────────────────────

  const renderIntent = () => (
    <div className="space-y-3 p-1">
      <p className="text-sm font-bold text-foreground">
        What would you like to change?
      </p>
      <div className="space-y-2">
        {INTENT_OPTIONS.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => {
                setSelectedIntent(option.id);
                setStep('form');
              }}
              className="w-full flex items-center gap-3.5 p-4 rounded-xl border border-border bg-card hover:bg-secondary/40 hover:border-accent/30 transition-all text-left group active:scale-[0.98]"
            >
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center shrink-0 group-hover:bg-accent/20 transition-colors">
                <Icon className="w-5 h-5 text-accent" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-foreground">{option.label}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{option.description}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  const renderForm = () => {
    if (!selectedIntent) return null;
    const fields = INTENT_FIELDS[selectedIntent];
    const intentLabel = INTENT_OPTIONS.find((o) => o.id === selectedIntent)?.label ?? '';

    return (
      <div className="space-y-4 p-1">
        <button
          type="button"
          onClick={() => setStep('intent')}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back
        </button>

        <p className="text-sm font-bold text-foreground">{intentLabel}</p>
        <p className="text-[11px] text-muted-foreground -mt-2">
          Leave fields blank to keep their current values.
        </p>

        <div className="space-y-3">
          {fields.map((field) => {
            const currentValue = getCurrentValue(tenantData, field.key);
            const format = field.format || ((v: any) => String(v ?? ''));

            return (
              <div key={field.key}>
                <label className="block text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1.5">
                  {field.label}
                </label>
                <p className="text-[11px] text-muted-foreground mb-1">
                  Current: <span className="font-semibold text-foreground">{currentValue != null ? format(currentValue) : '—'}</span>
                </p>
                <input
                  type={field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
                  value={formValues[field.key] ?? ''}
                  onChange={(e) =>
                    setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                  }
                  placeholder={`New ${field.label.toLowerCase()}`}
                  className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-muted-foreground/50"
                />
              </div>
            );
          })}
        </div>

        {/* Reason field */}
        <div>
          <label className="block text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1.5">
            Reason for change <span className="text-rose-500">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Explain why this change is needed..."
            rows={3}
            className="w-full px-3 py-2.5 rounded-lg border border-border bg-background text-foreground text-sm focus:outline-none focus:ring-1 focus:ring-accent placeholder:text-muted-foreground/50 resize-none"
          />
        </div>

        <button
          type="button"
          disabled={!canSubmit}
          onClick={() => setStep('summary')}
          className="w-full py-3 rounded-xl bg-accent text-accent-foreground text-sm font-bold hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
        >
          Review Changes
        </button>
      </div>
    );
  };

  const renderSummary = () => (
    <div className="space-y-4 p-1">
      <button
        type="button"
        onClick={() => setStep('form')}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to form
      </button>

      <p className="text-sm font-bold text-foreground">You're requesting</p>

      <ChangePreview changes={changedFields} />

      {/* Reason */}
      <div className="rounded-xl border border-border bg-secondary/20 p-3.5">
        <p className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider mb-1">
          Reason
        </p>
        <p className="text-xs text-foreground">{reason}</p>
      </div>

      {/* What happens next */}
      <div className="rounded-xl border border-accent/20 bg-accent/5 p-3.5">
        <p className="text-[10px] uppercase font-bold text-accent tracking-wider mb-1.5 flex items-center gap-1">
          <AlertCircle className="w-3 h-3" />
          What happens next
        </p>
        <p className="text-xs text-foreground leading-relaxed">
          {selectedIntent === 'personal'
            ? 'Personal information changes require tenant approval. The tenant will be notified.'
            : selectedIntent === 'agreement'
            ? 'Agreement amendments require tenant consent. The tenant must review and approve this change.'
            : selectedIntent === 'financial'
            ? 'Financial corrections may require tenant approval depending on the change.'
            : 'Room transfers may be applied immediately or require approval depending on the situation.'
          }
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setStep('form')}
          className="flex-1 py-3 rounded-xl border border-border bg-card text-foreground text-sm font-bold hover:bg-secondary/40 transition-all active:scale-[0.98]"
        >
          Back
        </button>
        <button
          type="button"
          disabled={submitMutation.isPending}
          onClick={() => submitMutation.mutate()}
          className="flex-1 py-3 rounded-xl bg-accent text-accent-foreground text-sm font-bold hover:bg-accent/90 disabled:opacity-70 transition-all active:scale-[0.98] flex items-center justify-center gap-2"
        >
          {submitMutation.isPending ? (
            <>
              <StayoLoader size="sm" label={null} />
              Submitting...
            </>
          ) : (
            'Submit Request'
          )}
        </button>
      </div>
    </div>
  );

  const renderResult = () => (
    <div className="flex flex-col items-center justify-center py-8 px-4 text-center space-y-4">
      {resultData?.applied ? (
        <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
          <CheckCircle2 className="w-7 h-7 text-emerald-600 dark:text-emerald-400" />
        </div>
      ) : (
        <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
          <Clock className="w-7 h-7 text-amber-600 dark:text-amber-400" />
        </div>
      )}

      <div>
        <p className="text-base font-bold text-foreground">
          {resultData?.applied ? 'Changes Applied' : 'Request Submitted'}
        </p>
        <p className="text-xs text-muted-foreground mt-1 max-w-[280px]">
          {resultData?.message}
        </p>
      </div>

      <button
        type="button"
        onClick={handleClose}
        className="mt-4 px-6 py-2.5 rounded-xl bg-accent text-accent-foreground text-sm font-bold hover:bg-accent/90 transition-all active:scale-[0.98]"
      >
        Done
      </button>
    </div>
  );

  // ─── Main Render ──────────────────────────────────────────────

  const stepTitles: Record<DrawerStep, string> = {
    intent: 'Request Change',
    form: 'Request Change',
    summary: 'Review Request',
    result: '',
  };

  return (
    <Sheet open={open} onOpenChange={(isOpen) => !isOpen && handleClose()}>
      <SheetContent
        side={isMobile ? 'bottom' : 'right'}
        className={
          isMobile
            ? 'h-[95dvh] rounded-t-2xl overflow-y-auto'
            : 'w-full sm:max-w-md overflow-y-auto'
        }
      >
        {step !== 'result' && (
          <SheetHeader>
            <SheetTitle className="text-base font-black">{stepTitles[step]}</SheetTitle>
            <SheetDescription className="text-[11px]">
              {step === 'intent' && 'Select what you\'d like to change for this tenant.'}
              {step === 'form' && 'Fill in the new values. Leave blank to keep current.'}
              {step === 'summary' && 'Review your changes before submitting.'}
            </SheetDescription>
          </SheetHeader>
        )}

        <div className="px-4 pb-6">
          {step === 'intent' && renderIntent()}
          {step === 'form' && renderForm()}
          {step === 'summary' && renderSummary()}
          {step === 'result' && renderResult()}
        </div>
      </SheetContent>
    </Sheet>
  );
}
