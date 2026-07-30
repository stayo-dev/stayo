import { useNavigate } from 'react-router-dom';

interface MoreScreenHeaderProps {
  backTo: string;
  backLabel: string;
  title: string;
  subtitle?: string;
}

/** Back-button + title header shared by every More sub-screen (Settings/Billing/Help/About) — matches Stayo App.dc.html's `backFromSettings`/`backFromBilling` pattern. */
export function MoreScreenHeader({ backTo, backLabel, title, subtitle }: MoreScreenHeaderProps) {
  const navigate = useNavigate();
  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={() => navigate(backTo)} className="flex w-fit items-center gap-2 py-1">
        <span className="flex h-8.5 w-8.5 items-center justify-center rounded-full border border-[#EAE1D8] bg-card">
          <span className="text-base leading-none text-[#6B6259]">‹</span>
        </span>
        <span className="text-[13px] font-medium text-[#6B6259]">{backLabel}</span>
      </button>
      <h1 className="mt-1 font-display text-[22px] font-extrabold tracking-tight text-foreground">{title}</h1>
      {subtitle && <p className="text-[12.5px] text-muted-foreground">{subtitle}</p>}
    </div>
  );
}
