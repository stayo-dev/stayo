import { Bell } from 'lucide-react';

/**
 * Stayo's own ask, shown before the browser's.
 *
 * It states what will be sent, because "stayo.com wants to send you
 * notifications" tells someone nothing and gets blocked. Only "Turn on"
 * escalates to the real permission dialog — and that dialog is one-shot, so
 * this card is the thing standing between a considered yes and a permanent no.
 */
export function PushPromptCard({
  headline,
  detail,
  onEnable,
  onDismiss,
}: {
  headline: string;
  detail: string;
  onEnable: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-[16px] border border-primary/20 bg-secondary/45 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-px flex h-7 w-7 flex-none items-center justify-center rounded-[9px] bg-primary/12 text-primary">
          <Bell className="h-4 w-4" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[14px] font-extrabold tracking-[-0.01em] text-foreground">{headline}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{detail}</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDismiss}
          className="min-h-[36px] rounded-xl px-3 font-display text-[12.5px] font-bold text-muted-foreground"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={onEnable}
          className="min-h-[36px] rounded-xl bg-primary px-3.5 font-display text-[12.5px] font-bold text-primary-foreground active:scale-[0.98] transition-transform"
        >
          Turn on
        </button>
      </div>
    </div>
  );
}
