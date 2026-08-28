import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { queryKeys } from '@lib/queryKeys';
import { useHostelPolicy } from '@features/settings/settingsHooks';
import { ownerManagedService } from '../api/ownerManaged';

interface AdoptTenantSheetProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  hostelId: string;
  tenantName: string;
}

const REMINDER_SETTINGS_PATH = '/owner/more/configuration/notifications';

function getErrorCode(error: unknown): string | undefined {
  return (error as { response?: { data?: { error?: { code?: string } } } })?.response?.data?.error?.code;
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (getErrorCode(error) === 'CAPACITY_EXCEEDED') {
    return 'That room is now full — move the tenant to a room with space first';
  }
  const data = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data;
  return data?.error?.message || fallback;
}

/**
 * Confirmation sheet for "Keep records myself" — see the header comment on
 * `InvitedTenantProfileView.tsx` for why this is permitted where the removed
 * Activate button was not.
 */
export function AdoptTenantSheet({ open, onClose, tenantId, hostelId, tenantName }: AdoptTenantSheetProps) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!open) setNote('');
  }, [open]);

  // WhatsApp is the only channel that reaches a tenant with no login, and it
  // defaults to off per hostel (ADR — see `reminder_whatsapp` in hostel-policy-service).
  // The reassuring line below would otherwise be false for most owners.
  const hostelPolicyQuery = useHostelPolicy(hostelId);
  const whatsappRemindersOn = Boolean(hostelPolicyQuery.data?.policy?.reminders?.channels?.whatsapp);

  const adoptMutation = useMutation({
    mutationFn: () => ownerManagedService.adopt({ tenantId, hostelId, note: note.trim() || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.tenants.detail(hostelId, tenantId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.tenants.all(hostelId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.tenants.list(hostelId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.portfolio.all() });
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenants'] });
      queryClient.invalidateQueries({ queryKey: ['owner', 'tenant', tenantId, 'detail'] });
      toast.success('Now managing ' + tenantName);
      onClose();
    },
  });

  return (
    <BottomSheet open={open} onOpenChange={(v) => !v && onClose()} title="Keep records myself">
      <div className="flex flex-col gap-4 pb-2">
        {adoptMutation.error && (
          <p className="rounded-xl border border-destructive/25 bg-destructive/10 px-3.5 py-2.5 text-[12.5px] font-semibold text-destructive">
            {getErrorMessage(adoptMutation.error, 'Something went wrong. Nothing was changed.')}
          </p>
        )}

        <p className="text-[13px] leading-relaxed text-foreground">
          {tenantName} will be added to your records as an active tenant. Rent will start generating
          {whatsappRemindersOn ? ' and reminders will go to their WhatsApp. ' : '. '}
          They won't have a login until they join the app themselves.
        </p>

        {!whatsappRemindersOn && (
          <p className="flex items-start gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3 text-[12px] font-semibold text-warning">
            <AlertTriangle className="mt-px h-4 w-4 shrink-0" strokeWidth={2.2} />
            <span>
              WhatsApp reminders are off for this hostel. {tenantName} won't receive anything until you turn them
              on.{' '}
              <Link to={REMINDER_SETTINGS_PATH} className="underline underline-offset-2">
                Turn on reminders
              </Link>
            </span>
          </p>
        )}

        <div>
          <label className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Note (optional)
          </label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why you're keeping this tenant's records yourself…"
            className="mt-1.5 min-h-[72px] w-full resize-none rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm text-foreground focus:border-primary focus:outline-none"
          />
        </div>

        <button
          type="button"
          disabled={adoptMutation.isPending}
          onClick={() => adoptMutation.mutate()}
          className="rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          {adoptMutation.isPending ? 'Saving…' : 'Keep records myself'}
        </button>
      </div>
    </BottomSheet>
  );
}
