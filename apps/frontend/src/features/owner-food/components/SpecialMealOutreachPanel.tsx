import { useState } from 'react';
import { BellRing, Loader2, Send } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { parseApiError } from '@lib/errors';
import { outreachActions, type SpecialCount } from '../specialMeals';

type Kind = 'ASK' | 'REMIND';

/**
 * "Ask now" / "Remind now" — the owner doesn't have to wait for the 18:00 and
 * 08:00 crons. Each tap names how many residents it will WhatsApp and asks for
 * confirmation first; nobody is ever messaged twice for the same serving.
 */
export function SpecialMealOutreachPanel({
  data,
  onSend,
  isSending,
}: {
  data: SpecialCount;
  onSend: (kind: Kind) => Promise<{ sent: number; failed: number; skipped: number }>;
  isSending: boolean;
}) {
  const [confirming, setConfirming] = useState<{ kind: Kind; label: string } | null>(null);
  const model = outreachActions(data.outreach, data.isOpen);
  if (!model || (!model.status && !model.ask && !model.remind)) return null;

  const send = async (kind: Kind) => {
    try {
      const r = await onSend(kind);
      if (r.sent === 0 && r.failed === 0) stayoToast.success('Everyone has already been messaged');
      else stayoToast.success(r.failed > 0 ? `Sent to ${r.sent} · ${r.failed} couldn't be reached` : `Sent to ${r.sent} residents`);
    } catch (e) {
      stayoToast.error(parseApiError(e) || "Couldn't send the question.");
    } finally {
      setConfirming(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      {model.status && <p className="text-[12.5px] font-medium text-muted-foreground">{model.status}</p>}
      {confirming ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-primary p-3">
          <p className="text-[14px] font-semibold">{confirming.label.replace(' · ', ' — ')} on WhatsApp now?</p>
          <div className="flex gap-2">
            <button disabled={isSending} onClick={() => send(confirming.kind)} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary py-3 text-[14px] font-bold text-primary-foreground">
              {isSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
            </button>
            <button disabled={isSending} onClick={() => setConfirming(null)} className="rounded-xl bg-muted px-4 py-3 text-[14px] font-semibold">Not now</button>
          </div>
        </div>
      ) : (
        <>
          {model.ask && (
            <button onClick={() => setConfirming({ kind: 'ASK', label: model.ask! })} className="flex items-center justify-center gap-2 rounded-xl bg-primary py-3 text-[14px] font-bold text-primary-foreground">
              <Send className="h-4 w-4" /> {model.ask}
            </button>
          )}
          {model.remind && (
            <button onClick={() => setConfirming({ kind: 'REMIND', label: model.remind! })} className="flex items-center justify-center gap-2 rounded-xl border border-primary py-3 text-[14px] font-semibold text-primary">
              <BellRing className="h-4 w-4" /> {model.remind}
            </button>
          )}
        </>
      )}
    </div>
  );
}
