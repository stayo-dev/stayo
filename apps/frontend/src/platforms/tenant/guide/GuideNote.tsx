import { Lightbulb } from 'lucide-react';

/**
 * One screen's introduction, shown inline and once.
 *
 * Deliberately **not** a spotlight. The Home welcome dims the screen because
 * it runs once for the whole app and has to point at specific things; a
 * per-tab hint that did the same would mean four full-screen modals in a
 * tenant's first week, which is how a guided journey turns into something
 * people dismiss unread.
 *
 * The inline form also buys something a cut-out cannot: it can describe a
 * feature that is not on screen right now. The Food tab's note can explain
 * kitchen polls on a day when no poll is running — a spotlight there would
 * have to dim the screen and highlight nothing, the exact failure ADR-139
 * documents on the owner side.
 */
export function GuideNote({
  title,
  body,
  onDismiss,
}: {
  title: string;
  body: string;
  onDismiss: () => void;
}) {
  return (
    <div className="rounded-[16px] border border-primary/20 bg-secondary/45 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-px flex h-7 w-7 flex-none items-center justify-center rounded-[9px] bg-primary/12 text-primary">
          <Lightbulb className="h-4 w-4" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-display text-[14px] font-extrabold tracking-[-0.01em] text-foreground">{title}</p>
          <p className="mt-1 text-[12.5px] leading-relaxed text-muted-foreground">{body}</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={onDismiss}
          className="min-h-[36px] rounded-xl bg-primary/10 px-3.5 font-display text-[12.5px] font-bold text-primary active:scale-[0.98] transition-transform"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
