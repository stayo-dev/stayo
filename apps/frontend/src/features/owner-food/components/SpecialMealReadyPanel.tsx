import { useState } from 'react';
import { BellRing, Check, Loader2 } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { parseApiError } from '@lib/errors';
import { readyButtons, type SpecialCount } from '../specialMeals';

type Choice = 'VEG' | 'NON_VEG' | 'BOTH';

/**
 * "Food's ready" — the cook's dinner bell (spec addendum 2026-10-10). One tap
 * WhatsApps everyone that choice was cooked for. A confirm step names the
 * number first, because it cannot be unsent.
 */
export function SpecialMealReadyPanel({
  data,
  onSend,
  isSending,
  large = false,
}: {
  data: SpecialCount;
  onSend: (choice: Choice) => Promise<Array<{ choice: string; sent: number; failed: number; alreadySent: boolean }>>;
  isSending: boolean;
  large?: boolean;
}) {
  const [confirming, setConfirming] = useState<{ choice: Choice; label: string } | null>(null);
  const model = readyButtons(data.count, data.readyAlerts ?? [], data.isToday);
  if (!model || model.buttons.length === 0) return null;

  const send = async (choice: Choice) => {
    try {
      const alerts = await onSend(choice);
      const sent = alerts.reduce((n, a) => n + a.sent, 0);
      const failed = alerts.reduce((n, a) => n + a.failed, 0);
      stayoToast.success(failed > 0 ? `Told ${sent} residents · ${failed} couldn't be reached` : `Told ${sent} residents it's ready 🔔`);
    } catch (e) {
      stayoToast.error(parseApiError(e) || "Couldn't send the ready alert.");
    } finally {
      setConfirming(null);
    }
  };

  const size = large ? 'py-4 text-[16px]' : 'py-3 text-[14px]';
  return (
    <div className="flex flex-col gap-2 print:hidden">
      {confirming ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-primary p-3">
          <p className="text-[14px] font-semibold">{confirming.label.replace(' · tell', ' — WhatsApp')} residents now?</p>
          <div className="flex gap-2">
            <button disabled={isSending} onClick={() => send(confirming.choice)} className={`flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary font-bold text-primary-foreground ${size}`}>
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />} Send
            </button>
            <button disabled={isSending} onClick={() => setConfirming(null)} className={`rounded-xl bg-muted px-4 font-semibold ${size}`}>Not yet</button>
          </div>
        </div>
      ) : (
        <>
          {model.buttons.map((b) =>
            b.sent ? (
              <p key={b.choice} className="flex items-center gap-2 rounded-xl bg-muted px-4 py-3 text-[13.5px] font-semibold text-muted-foreground">
                <Check className="h-4 w-4" /> {b.choice === 'VEG' ? 'Veg' : 'Non-veg'} ready · {b.sent}
              </p>
            ) : (
              <button key={b.choice} onClick={() => setConfirming({ choice: b.choice, label: b.label })} className={`flex items-center justify-center gap-2 rounded-xl bg-primary font-bold text-primary-foreground ${size}`}>
                <BellRing className="h-4 w-4" /> {b.label}
              </button>
            ),
          )}
          {model.bothLabel && (
            <button onClick={() => setConfirming({ choice: 'BOTH', label: model.bothLabel! })} className={`rounded-xl border border-primary font-semibold text-primary ${size}`}>
              {model.bothLabel}
            </button>
          )}
        </>
      )}
    </div>
  );
}
