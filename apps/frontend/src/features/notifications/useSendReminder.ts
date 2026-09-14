import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { reminderService } from '@features/notifications/api';
import { describeReminderOutcome, type SendReminderResponse } from './reminderOutcome';

/**
 * Sending one tenant a payment reminder, by hand.
 *
 * Reminders go out automatically, but an owner standing in front of a tenant —
 * or working down the list on a Sunday — wants to nudge *this* person now. That
 * is a one-tap action wherever the tenant appears, so the mutation and its
 * error vocabulary live here rather than being restated at each call site.
 *
 * `NO_REMINDERS_LEFT` is called out by name because it is the one failure the
 * owner can act on (it is a plan limit, not a fault).
 *
 * The success path reports what the delivery report *says*, not the fact that
 * the request returned 200. This hook used to toast "Reminder sent"
 * unconditionally, which is why months of rent reminders rejected by Meta
 * looked, to the only person watching, exactly like reminders that arrived.
 * The reading of the report is in `reminderOutcome.ts`, under test.
 */
export function useSendReminder(tenantId: string, options?: { onSent?: () => void }) {
  return useMutation({
    mutationFn: () => reminderService.sendToTenant(tenantId),
    onSuccess: (data: SendReminderResponse) => {
      const outcome = describeReminderOutcome(data);

      if (outcome.tone === 'success') toast.success(outcome.message);
      else if (outcome.tone === 'warning') toast.warning(outcome.message);
      else toast.error(outcome.message);

      // Only a real delivery should disable the button. A failed send must stay
      // retryable — the owner's next tap is the retry.
      if (outcome.delivered) options?.onSent?.();
    },
    onError: (e: Error & { response?: { data?: { error?: { message?: string; code?: string } } } }) => {
      const code = e?.response?.data?.error?.code;
      if (code === 'NO_REMINDERS_LEFT') toast.error('No reminder credits left');
      else toast.error(e?.response?.data?.error?.message ?? 'Failed to send reminder');
    },
  });
}
