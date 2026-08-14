interface SuccessPanelProps {
  title: string;
  sub: string;
  reference: string;
  onTrackStatus: () => void;
  onDone: () => void;
}

/** Shared confirmation shown after any Room/Profile form submits — pulsing-ring checkmark, reference card, Track status / Done. */
export function SuccessPanel({ title, sub, reference, onTrackStatus, onDone }: SuccessPanelProps) {
  return (
    <div className="fixed inset-0 z-[47] flex flex-col bg-background">
      <div className="flex flex-1 flex-col items-center overflow-auto px-[22px] pb-6 pt-[70px] text-center">
        <div className="relative h-20 w-20">
          <div className="stayo-ring-pulse absolute inset-0 rounded-full bg-[#7FBF9B]" />
          <div className="stayo-pop-in relative flex h-20 w-20 items-center justify-center rounded-full bg-success">
            <svg width="38" height="38" viewBox="0 0 34 34">
              <path d="M9 17.5 L14.5 23 L25 11" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
        </div>
        <div className="mt-5 font-display text-[22px] font-extrabold tracking-[-0.02em] text-foreground">{title}</div>
        <p className="mt-1.5 max-w-[260px] text-[13px] leading-relaxed text-[#8A7F75]">{sub}</p>
        <div className="mt-[22px] flex w-full items-center justify-between rounded-2xl border border-[#EFE6DA] bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="text-left">
            <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-[#A2978B]">Reference</div>
            <div className="mt-0.5 font-display text-[18px] font-extrabold tracking-[-0.01em] text-foreground">{reference}</div>
          </div>
          <span className="rounded-full bg-warning-bg px-[13px] py-1.5 text-[11px] font-bold text-warning">Pending</span>
        </div>
        <div className="mt-3 flex w-full items-center gap-2.5 rounded-xl border border-[#D9EEE2] bg-[#F0F6F2] p-[13px_15px]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#1F7A52" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="flex-none">
            <path d="M6 15V10c0-3 2-5 5-5s5 2 5 5v5l1.5 2h-13z" />
            <path d="M9.5 18.5c.5 1 3 1 3.5 0" />
          </svg>
          <span className="flex-1 text-left text-[12px] leading-snug text-success">We'll send notifications as the status updates.</span>
        </div>
      </div>
      <div className="flex flex-none flex-col gap-2.5 px-[22px] pb-[26px] pt-3.5">
        <button type="button" onClick={onTrackStatus} className="rounded-2xl border border-[#E4DACE] bg-card py-[15px] text-center font-display text-sm font-bold text-[#4A433C]">
          Track status
        </button>
        <button type="button" onClick={onDone} className="rounded-2xl bg-foreground py-4 text-center font-display text-[15px] font-bold text-background">
          Done
        </button>
      </div>
    </div>
  );
}
