import { RefreshCw } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useReactivateHostel } from '@features/settings/settingsHooks';

interface ReactivateHostelModalProps {
  open: boolean;
  onClose: () => void;
  hostelId: string | null;
  hostelName: string;
}

function getErrorMessage(error: unknown, fallback: string) {
  const data = (error as { response?: { data?: { error?: { message?: string } } } })?.response?.data;
  return data?.error?.message || fallback;
}

export function ReactivateHostelModal({
  open,
  onClose,
  hostelId,
  hostelName,
}: ReactivateHostelModalProps) {
  const reactivateMutation = useReactivateHostel();

  if (!hostelId) return null;

  const handleConfirmReactivate = () => {
    reactivateMutation.mutate(hostelId, {
      onSuccess: () => {
        stayoToast.success(`${hostelName} has been reactivated successfully`);
        onClose();
      },
      onError: (error) => {
        stayoToast.error(getErrorMessage(error, 'Could not reactivate this hostel'));
      },
    });
  };

  return (
    <BottomSheet open={open} onOpenChange={(v) => !v && onClose()} title={`Reactivate ${hostelName}`}>
      <div className="flex flex-col gap-4.5 pt-1">
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-3.5 dark:border-emerald-900/40 dark:bg-emerald-950/20">
          <div className="flex gap-2.5">
            <RefreshCw className="h-5 w-5 flex-none text-emerald-600 dark:text-emerald-400" />
            <div className="text-[12.5px] leading-relaxed text-emerald-900 dark:text-emerald-200">
              Reactivating <b className="font-semibold">{hostelName}</b> brings it back into active operations. It will reappear on your main active property list and operational dashboards.
            </div>
          </div>
        </div>

        {reactivateMutation.isError && (
          <p className="text-[11.5px] font-semibold text-destructive">
            {getErrorMessage(reactivateMutation.error, 'Could not reactivate this hostel')}
          </p>
        )}

        <div className="flex gap-2.5 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-border px-5 py-3.5 font-display text-sm font-bold text-foreground transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={reactivateMutation.isPending}
            onClick={handleConfirmReactivate}
            className="flex-1 rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {reactivateMutation.isPending ? 'Reactivating…' : 'Confirm & Reactivate Property'}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
