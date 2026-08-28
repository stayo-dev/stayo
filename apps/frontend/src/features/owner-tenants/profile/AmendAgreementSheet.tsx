import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, Clock, IndianRupee } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { StayoLoader } from '@shared/ui/brand';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { changeRequestKeys } from '@features/change-management';
import { agreementAmendmentService, type AgreementAmendment } from '../api/agreementAmendment';
import type { AmendmentOutcome } from './amendmentOutcome';
import type { RealTenantDetail } from '../hooks/useTenantDetail';

/**
 * Amend the agreement's terms.
 *
 * This replaces the four-option "Request Change" drawer:
 *
 *  - **Personal information** is gone. An owner does not edit a tenant's
 *    identity — that's the tenant's to change.
 *  - **Transfer Room** is gone; it asked for a UUID in a text box and the
 *    facade dropped it. Room changes are two taps in ChangeRoomSheet.
 *  - **Financial data** folded in here, because a deposit *is* an agreement
 *    term.
 *  - **Monthly rent** is not offered. Rent has a purpose-built,
 *    identity-confirmed endpoint that also reprices unpaid obligations; the
 *    Stay tab's "Change rent" is the one way to change it.
 *
 * Fields are seeded from the full overview response. The old drawer was handed
 * four fields and asked about nine, so "Current:" read "—" for most of them and
 * the diff it showed the owner was against nothing.
 */

interface AmendAgreementSheetProps {
  open: boolean;
  onClose: () => void;
  tenant: RealTenantDetail;
  onChangeRent: () => void;
}

const money = (value: number | null | undefined) =>
  value == null ? '—' : `₹${Number(value).toLocaleString('en-IN')}`;

type FieldKey = keyof AgreementAmendment;

interface FieldDef {
  key: FieldKey;
  label: string;
  type: 'number' | 'date' | 'select';
  options?: Array<{ value: string; label: string }>;
  format?: (value: any) => string;
}

const FIELDS: FieldDef[] = [
  { key: 'agreement_duration_months', label: 'Agreement duration (months)', type: 'number' },
  { key: 'agreement_start_date', label: 'Agreement start date', type: 'date' },
  { key: 'security_deposit', label: 'Security deposit', type: 'number', format: money },
  { key: 'maintenance_charge', label: 'Maintenance charge', type: 'number', format: money },
  {
    key: 'maintenance_type',
    label: 'Maintenance type',
    type: 'select',
    options: [
      { value: 'NONE', label: 'None' },
      { value: 'MONTHLY', label: 'Monthly' },
      { value: 'ONE_TIME', label: 'One-time' },
    ],
  },
];

export function AmendAgreementSheet({ open, onClose, tenant, onChangeRent }: AmendAgreementSheetProps) {
  const queryClient = useQueryClient();
  const [values, setValues] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [outcome, setOutcome] = useState<AmendmentOutcome | null>(null);

  const current: Record<FieldKey, any> = {
    agreement_duration_months: tenant.agreement?.durationMonths ?? null,
    agreement_start_date: tenant.agreement?.startDate ?? null,
    security_deposit: tenant.stay.deposit,
    maintenance_charge: tenant.maintenanceCharge,
    maintenance_type: tenant.maintenanceType,
  };

  const changed = FIELDS.filter((field) => {
    const next = (values[field.key] ?? '').trim();
    if (!next) return false;
    return next !== String(current[field.key] ?? '');
  });

  const canSubmit = changed.length > 0 && reason.trim().length > 0;

  const reset = () => {
    setValues({});
    setReason('');
    setOutcome(null);
  };

  const close = () => {
    reset();
    onClose();
  };

  const submit = useMutation({
    mutationFn: () => {
      const changes: AgreementAmendment = {};
      for (const field of changed) {
        const raw = values[field.key].trim();
        (changes as any)[field.key] = field.type === 'number' ? Number(raw) : raw;
      }
      return agreementAmendmentService.submit(tenant.id, changes, reason.trim(), tenant.hostelId);
    },
    onSuccess: (result) => {
      setOutcome(result);
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenant', tenant.id, 'detail'] });
      queryClient.invalidateQueries({ queryKey: changeRequestKeys.all() });
    },
    onError: (error: any) => {
      const message = error?.response?.data?.error?.message || error?.message || '';
      // The facade's optimistic-version check fires when the tenant changed
      // underneath the owner — a retry with stale values would silently lose
      // whichever change landed first.
      stayoToast.error(
        /CONCURRENCY_ERROR/i.test(message)
          ? 'This tenant changed while you were editing — reopen and try again.'
          : message || 'Could not submit this amendment.',
      );
    },
  });

  return (
    <BottomSheet open={open} onOpenChange={(next) => !next && close()} title="Amend agreement">
      {outcome ? (
        <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
          <span
            className={`flex h-14 w-14 items-center justify-center rounded-2xl ${
              outcome.applied ? 'bg-success/12' : 'bg-warning/12'
            }`}
          >
            {outcome.applied ? (
              <CheckCircle2 className="h-7 w-7 text-success" strokeWidth={1.9} />
            ) : (
              <Clock className="h-7 w-7 text-warning" strokeWidth={1.9} />
            )}
          </span>
          <div>
            <p className="font-display text-base font-extrabold text-foreground">
              {outcome.applied ? 'Agreement updated' : 'Waiting on the tenant'}
            </p>
            <p className="mx-auto mt-1 max-w-[280px] text-[12px] leading-relaxed text-muted-foreground">
              {outcome.message}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            className="mt-2 rounded-xl bg-primary px-6 py-2.5 font-display text-[13px] font-bold text-primary-foreground"
          >
            Done
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5">
          <p className="px-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Leave a field blank to keep it. Contractual terms need the tenant’s agreement, so some
            changes are sent for approval rather than applied straight away.
          </p>

          {FIELDS.map((field) => {
            const format = field.format ?? ((v: any) => (v == null || v === '' ? '—' : String(v)));
            return (
              <div key={field.key}>
                <label
                  htmlFor={`amend-${field.key}`}
                  className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
                >
                  {field.label}
                </label>
                <p className="mb-1.5 text-[11px] text-muted-foreground">
                  Current: <span className="font-semibold text-foreground">{format(current[field.key])}</span>
                </p>
                {field.type === 'select' ? (
                  <select
                    id={`amend-${field.key}`}
                    value={values[field.key] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    className="w-full rounded-[11px] border border-border bg-background px-3 py-2.5 text-[12.5px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">Keep current</option>
                    {field.options!.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`amend-${field.key}`}
                    type={field.type}
                    value={values[field.key] ?? ''}
                    onChange={(e) => setValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    placeholder={`New ${field.label.toLowerCase()}`}
                    className="w-full rounded-[11px] border border-border bg-background px-3 py-2.5 text-[12.5px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                )}
              </div>
            );
          })}

          {/* Rent is a different mechanism, not a missing field — say where it lives. */}
          <button
            type="button"
            onClick={() => {
              close();
              onChangeRent();
            }}
            className="flex items-center gap-2.5 rounded-[13px] border border-border bg-muted/50 p-3 text-left"
          >
            <IndianRupee className="h-4 w-4 flex-none text-primary" strokeWidth={1.9} />
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-bold text-foreground">
                Rent is {money(tenant.stay.monthlyRent)} / month
              </span>
              <span className="block text-[11px] text-muted-foreground">
                Changing rent reprices unpaid charges — it has its own step
              </span>
            </span>
            <ArrowRight className="h-3.5 w-3.5 flex-none text-muted-foreground" strokeWidth={2.2} />
          </button>

          <div>
            <label
              htmlFor="amend-reason"
              className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-muted-foreground"
            >
              Reason for change <span className="text-destructive">*</span>
            </label>
            <textarea
              id="amend-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="The tenant sees this — explain what changed and why."
              className="w-full resize-none rounded-[11px] border border-border bg-background px-3 py-2.5 text-[12.5px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <button
            type="button"
            disabled={!canSubmit || submit.isPending}
            onClick={() => submit.mutate()}
            className="flex items-center justify-center gap-2 rounded-2xl bg-primary py-3.5 font-display text-[14px] font-bold text-primary-foreground shadow-[0_6px_16px_rgba(143,74,56,0.28)] transition-opacity disabled:opacity-40 disabled:shadow-none"
          >
            {submit.isPending ? (
              <>
                <StayoLoader size="sm" label={null} />
                Submitting…
              </>
            ) : changed.length === 0 ? (
              'Change something to continue'
            ) : (
              `Submit ${changed.length} change${changed.length === 1 ? '' : 's'}`
            )}
          </button>
        </div>
      )}
    </BottomSheet>
  );
}
