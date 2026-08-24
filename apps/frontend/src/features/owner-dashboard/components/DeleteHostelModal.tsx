import { useEffect, useState } from 'react';
import { AlertTriangle, Trash2 } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useDeleteHostelPermanently } from '@features/settings/settingsHooks';
import { confirmHostelDeletion } from '../hostelDeletion';

/**
 * Deleting an archived hostel for good.
 *
 * Archiving already existed and is right for a property that carried real
 * tenancies. It left nothing to do about a hostel that never carried
 * anything — a test entry, a typo — which sat in the Archived tab forever
 * with Reactivate as its only action.
 *
 * This is the only irreversible action in the owner app, so it asks for the
 * hostel's name to be typed and says plainly that there is no undo. The
 * server is the real guard: it accepts only an archived hostel with no
 * tenants, payments, obligations, agreements, receipts, expenses or
 * enquiries, and its refusal is shown verbatim rather than paraphrased.
 */
export function DeleteHostelModal({
  open,
  onClose,
  hostelId,
  hostelName,
}: {
  open: boolean;
  onClose: () => void;
  hostelId: string | null;
  hostelName: string;
}) {
  const [typed, setTyped] = useState('');
  const remove = useDeleteHostelPermanently();

  useEffect(() => {
    if (!open) {
      setTyped('');
      remove.reset();
    }
    // `remove` is a stable mutation object from react-query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!hostelId) return null;

  const confirmed = confirmHostelDeletion(typed, hostelName);

  const handleDelete = () => {
    remove.mutate(hostelId, {
      onSuccess: () => {
        stayoToast.success(`${hostelName} deleted.`);
        onClose();
      },
      onError: (error: any) => {
        const message =
          error?.response?.data?.error?.message ?? error?.response?.data?.error ?? error?.message;
        stayoToast.error(
          typeof message === 'string' && message.trim() ? message : 'Could not delete this hostel.',
        );
      },
    });
  };

  return (
    <BottomSheet open={open} onOpenChange={(v) => !v && onClose()} title={`Delete ${hostelName}?`}>
      <div className="flex flex-col gap-4 pt-1">
        <div className="flex gap-2.5 rounded-2xl border border-destructive/25 bg-destructive-bg/50 p-3.5">
          <AlertTriangle className="h-5 w-5 flex-none text-destructive" strokeWidth={2} />
          <div className="text-[12.5px] leading-relaxed text-foreground">
            <b className="font-semibold">This cannot be undone.</b> Unlike archiving,{' '}
            <b className="font-semibold">{hostelName}</b> and its floors and rooms are removed
            completely — there is nothing left to reactivate.
          </div>
        </div>

        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          Only a hostel that never had a tenant, a payment or an agreement can be deleted. If this one
          has any history, it stays archived and nothing is lost.
        </p>

        <label className="block">
          <span className="text-[11.5px] font-bold uppercase tracking-wider text-muted-foreground">
            Type <span className="text-foreground">{hostelName}</span> to confirm
          </span>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={hostelName}
            autoComplete="off"
            aria-label={`Type ${hostelName} to confirm deletion`}
            className="mt-2 w-full rounded-xl border-[1.5px] border-field-border bg-input-background px-3.5 py-3 text-[16px] font-semibold text-foreground placeholder:font-normal placeholder:text-muted-foreground/60 focus:border-destructive focus:outline-none focus:ring-4 focus:ring-destructive/15"
          />
        </label>

        <div className="flex gap-2.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border px-5 py-3.5 font-display text-sm font-bold text-foreground transition-colors hover:bg-muted"
          >
            Keep it
          </button>
          <button
            type="button"
            disabled={!confirmed || remove.isPending}
            onClick={handleDelete}
            className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-destructive py-3.5 font-display text-sm font-bold text-destructive-foreground transition-opacity hover:opacity-90 disabled:opacity-45"
          >
            <Trash2 className="h-4 w-4" strokeWidth={2} />
            {remove.isPending ? 'Deleting…' : 'Delete for good'}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
