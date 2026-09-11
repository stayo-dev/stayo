import { useEffect, useState } from 'react';
import { Bell, BellOff, CheckCircle2 } from 'lucide-react';
import { StayoLoader } from '@shared/ui/brand';
import { ensurePushSubscription, readPushStatus } from './ensurePushSubscription';
import { PUSH_STATUS_COPY, type PushStatus } from './pushSetup';

/**
 * Push notifications for *this device*, somewhere an owner can always find it.
 *
 * The only other way in was a soft prompt on Alerts › Leads that disappears
 * for good once dismissed or once the browser has decided. This card is always
 * here, says exactly what state the device is in, and — where it can — fixes
 * it with one tap.
 */
export function PushSettingsCard() {
  const [status, setStatus] = useState<PushStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void readPushStatus().then((s) => alive && setStatus(s));
    return () => {
      alive = false;
    };
  }, []);

  if (!status) return null;

  const copy = PUSH_STATUS_COPY[status];
  const actionable = status === 'needs-permission' || status === 'needs-subscription';

  const turnOn = async () => {
    setBusy(true);
    setFailed(false);
    try {
      setStatus(await ensurePushSubscription({ ask: true }));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-[14px] border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 flex-none items-center justify-center rounded-xl ${
            status === 'on' ? 'bg-success/10 text-success' : actionable ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
          }`}
        >
          {status === 'on' ? <CheckCircle2 className="h-5 w-5" /> : actionable ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5" />}
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Push notifications</div>
          <div className="mt-0.5 font-display text-[15px] font-bold text-foreground">{copy.title}</div>
          <p className="mt-0.5 text-[12.5px] leading-relaxed text-muted-foreground">{copy.body}</p>
        </div>
      </div>

      {actionable && (
        <button
          type="button"
          onClick={() => void turnOn()}
          disabled={busy}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary font-display text-[14px] font-bold text-primary-foreground disabled:opacity-60"
        >
          {busy && <StayoLoader size="sm" label={null} />}
          Turn on
        </button>
      )}

      {failed && (
        <p className="text-[12px] leading-relaxed text-destructive">
          This browser couldn’t register for notifications. On Brave, turn on “Use Google services for push messaging” in its
          privacy settings, then try again.
        </p>
      )}
    </div>
  );
}
