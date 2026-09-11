import { Bell } from 'lucide-react';
import { useSendReminder } from '@features/notifications/useSendReminder';
import { cn } from '@/app/components/ui/utils';

interface Props {
  hostelId: string;
  tenantId: string;
  className?: string;
}

export function ReminderActionBar({ tenantId, className }: Props) {
  const mutation = useSendReminder(tenantId);

  return (
    <div
      className={cn(
        'rounded-xl border border-border bg-card p-3 shadow-sm',
        className
      )}
    >
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-accent text-accent-foreground font-semibold text-sm touch-manipulation disabled:opacity-50 active:scale-[0.98] transition-transform"
      >
        <Bell className="w-4 h-4" />
        {mutation.isPending ? 'Sending…' : 'Send payment reminder'}
      </button>
    </div>
  );
}
