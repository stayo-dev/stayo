import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { platformAdminService } from '@features/platform-admin/api';
import { AdminDrawer } from '../drawer/AdminDrawer';
import { useToast } from '../layout/toastContext';
import { PERMISSION_GROUPS, PERMISSION_LABEL, type ManagerPermission } from './managerRows';
import {
  type WizardStep,
  type DetailsForm,
  validateDetailsForm,
  describeAddManagerError,
  getErrorCode,
  togglePermission,
} from './addManagerFlow';

const inputClass =
  'w-full rounded-[10px] border border-[#E7DDD1] bg-white px-3 py-2.5 text-[13px] text-[#2A2521] outline-none focus:border-[#B46A55]';
const labelClass = 'mb-1.5 block text-[11.5px] font-semibold text-[#8A7F75]';
const primaryButtonClass =
  'w-full rounded-[10px] bg-[#221E1A] px-4 py-2.5 text-center font-admin text-[13px] font-bold text-white disabled:opacity-40';
const secondaryButtonClass =
  'w-full rounded-[10px] border border-[#E7DDD1] bg-white px-4 py-2.5 text-center text-[13px] font-semibold text-[#5A5147]';
const errorTextClass = 'mt-1.5 text-[12px] font-medium text-[#B3402F]';

/**
 * Super Admin "Add Manager" wizard (ADR-212). 3-step: Details -> Permissions
 * -> Review & Send. `createManager` both creates the account AND sends the
 * activation invitation in one call (unlike Add Owner's separate
 * create-then-approve steps) — see manager-service.ts / manager-invitation-service.ts.
 */
export function AddManagerDrawer({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const fireToast = useToast();

  const [step, setStep] = useState<WizardStep>('details');
  const [form, setForm] = useState<DetailsForm>({ name: '', email: '', phone: '' });
  const [formError, setFormError] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<ManagerPermission[]>([]);
  const [activationLink, setActivationLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const createManager = useMutation({
    mutationFn: () => platformAdminService.createManager({ ...form, permissions }),
    onSuccess: (result) => {
      setActivationLink(result.invitation?.activationLink ?? null);
      setStep('sent');
      queryClient.invalidateQueries({ queryKey: ['admin', 'managers'] });
      fireToast('Manager created — invitation sent', 'ok');
    },
    onError: (err) => fireToast(describeAddManagerError(getErrorCode(err)), 'no'),
  });

  function handleDetailsSubmit() {
    const result = validateDetailsForm(form);
    if (!result.valid) {
      setFormError((result as { valid: false; error: string }).error);
      return;
    }
    setFormError(null);
    setStep('permissions');
  }

  const title = step === 'sent' ? 'Invitation sent' : 'Add manager';

  return (
    <AdminDrawer title={title} initials="+" tint="#B46A55" onClose={onClose}>
      {step === 'details' && (
        <div className="flex flex-col gap-4">
          <div>
            <label className={labelClass}>Name</label>
            <input
              className={inputClass}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Manager's full name"
            />
          </div>
          <div>
            <label className={labelClass}>Email</label>
            <input
              className={inputClass}
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="manager@example.com"
            />
          </div>
          <div>
            <label className={labelClass}>Phone number</label>
            <input
              className={inputClass}
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="98765 43210"
            />
          </div>
          {formError && <p className={errorTextClass}>{formError}</p>}
          <button type="button" className={primaryButtonClass} onClick={handleDetailsSubmit}>
            Continue
          </button>
        </div>
      )}

      {step === 'permissions' && (
        <div className="flex flex-col gap-4">
          <p className="text-[12.5px] text-[#8A7F75]">
            Choose what this manager can access. Enforced on every request — not just hidden from view.
          </p>
          {PERMISSION_GROUPS.map((group) => (
            <div key={group.label} className="rounded-2xl border border-[#EFE6DA] bg-white">
              <div className="border-b border-[#F2ECE5] px-[18px] py-[10px] text-[11px] font-bold uppercase tracking-[.06em] text-[#A2978B]">
                {group.label}
              </div>
              <div className="flex flex-col">
                {group.permissions.map((permission, index) => {
                  const checked = permissions.includes(permission);
                  return (
                    <label
                      key={permission}
                      className={`flex cursor-pointer items-center justify-between gap-3 px-[18px] py-3 ${
                        index > 0 ? 'border-t border-[#F2ECE5]' : ''
                      }`}
                    >
                      <span className="text-[12.5px] font-semibold text-[#2A2521]">{PERMISSION_LABEL[permission]}</span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setPermissions((current) => togglePermission(current, permission))}
                        className="h-4 w-4 accent-[#221E1A]"
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
          <button type="button" className={primaryButtonClass} onClick={() => setStep('review')}>
            Continue
          </button>
          <button type="button" className={secondaryButtonClass} onClick={() => setStep('details')}>
            Back
          </button>
        </div>
      )}

      {step === 'review' && (
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border border-[#EFE6DA] bg-white px-[18px] py-4">
            <p className="text-[11px] font-bold uppercase tracking-[.06em] text-[#A2978B]">Manager ready</p>
            <div className="mt-3 flex flex-col gap-2">
              <div className="flex justify-between text-[12.5px]">
                <span className="text-[#8A7F75]">Name</span>
                <span className="font-semibold text-[#2A2521]">{form.name}</span>
              </div>
              <div className="flex justify-between text-[12.5px]">
                <span className="text-[#8A7F75]">Email</span>
                <span className="font-semibold text-[#2A2521]">{form.email}</span>
              </div>
              <div className="flex justify-between text-[12.5px]">
                <span className="text-[#8A7F75]">Phone</span>
                <span className="font-semibold text-[#2A2521]">{form.phone}</span>
              </div>
              <div className="flex justify-between gap-3 text-[12.5px]">
                <span className="text-[#8A7F75]">Permissions</span>
                <span className="text-right font-semibold text-[#2A2521]">
                  {permissions.length === 0 ? 'None' : permissions.map((p) => PERMISSION_LABEL[p]).join(', ')}
                </span>
              </div>
            </div>
          </div>
          <button
            type="button"
            className={primaryButtonClass}
            disabled={createManager.isPending}
            onClick={() => createManager.mutate()}
          >
            {createManager.isPending ? 'Creating…' : 'Create & send invitation'}
          </button>
          <button type="button" className={secondaryButtonClass} onClick={() => setStep('permissions')}>
            Back
          </button>
        </div>
      )}

      {step === 'sent' && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-[#CDE6D8] bg-[#EAF3EE] px-[18px] py-6 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#1F7A52]">
              <Check className="h-5 w-5 text-white" strokeWidth={3} />
            </span>
            <p className="text-[13px] font-semibold text-[#1F7A52]">Invitation sent</p>
            <p className="text-[12px] text-[#5A5147]">Sent to {form.email}</p>
          </div>
          {activationLink && (
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => {
                navigator.clipboard?.writeText(activationLink).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              <span className="inline-flex items-center justify-center gap-2">
                <Copy className="h-3.5 w-3.5" />
                {copied ? 'Copied' : 'Copy link'}
              </span>
            </button>
          )}
          <button type="button" className={primaryButtonClass} onClick={onClose}>
            Done
          </button>
        </div>
      )}
    </AdminDrawer>
  );
}
