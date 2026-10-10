import { useState } from 'react';
import { Send } from 'lucide-react';
import { toast } from 'sonner';
import { tenantService } from '@features/tenants/api';
import type { MockTenant } from '@shared/mocks/tenants';
import { bulkResend, describeBulkResend, type ResendOutcome } from '../invite/bulkResend';
import { resendFailureBody, resolveResendDelivery } from '../invite/inviteDelivery';

interface ResendExpiredButtonProps {
  expired: MockTenant[];
  onDone: () => void;
}

/** Same call and the same reading of its answer as the profile's "Send new link". */
async function resendOne(tenant: MockTenant): Promise<ResendOutcome> {
  try {
    const response = await tenantService.resendInvitation(tenant.phone);
    return resolveResendDelivery(response, null).channel === 'none' ? 'not-delivered' : 'delivered';
  } catch (error) {
    // A 502 DELIVERY_FAILED still renewed the link; only delivery failed.
    return resendFailureBody(error) ? 'not-delivered' : 'failed';
  }
}

/**
 * "Send new links to all N" under Invited → Link expired. Asks once before
 * sending, because it messages every one of them on WhatsApp.
 */
export function ResendExpiredButton({ expired, onDone }: ResendExpiredButtonProps) {
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const count = expired.length;
  if (count === 0 && !progress) return null;

  const run = async () => {
    setConfirming(false);
    setProgress({ done: 0, total: count });
    const result = await bulkResend(expired, resendOne, (done, total) => setProgress({ done, total }));
    setProgress(null);
    const message = describeBulkResend(result);
    if (result.failed.length > 0 || result.notDelivered.length > 0) toast.warning(message, { duration: 8000 });
    else toast.success(message);
    onDone();
  };

  if (progress) {
    return (
      <div className="flex min-h-10 items-center justify-center gap-2 rounded-[11px] bg-primary/10 text-[12.5px] font-bold text-primary" role="status">
        <Send className="h-3.5 w-3.5 animate-pulse" />
        Sending {progress.done} of {progress.total}…
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="flex flex-col gap-2 rounded-[11px] border border-primary/30 bg-primary/5 p-2.5">
        <p className="text-[12px] leading-snug text-foreground">
          Send a fresh 7-day link to {count} {count === 1 ? 'tenant' : 'tenants'} on WhatsApp (email if WhatsApp fails)?
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="min-h-10 flex-1 rounded-[10px] border border-border bg-card text-[12.5px] font-bold text-foreground"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={run}
            className="min-h-10 flex-1 rounded-[10px] bg-primary text-[12.5px] font-bold text-primary-foreground"
          >
            Send to {count}
          </button>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="flex min-h-10 items-center justify-center gap-2 rounded-[11px] bg-primary text-[12.5px] font-bold text-primary-foreground"
    >
      <Send className="h-3.5 w-3.5" />
      Send new links to all {count}
    </button>
  );
}
