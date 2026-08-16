import { ADMIN_CARD } from '../theme/palette';

/**
 * The console's one honest-gap component.
 *
 * Several screens in the design have no backend yet (settlements, reports,
 * the revenue calendar, KYC business details). Rendering a zero or a sample
 * row on those screens would let an admin read an unbuilt feature as a real
 * one reporting that business is quiet — which is worse than showing nothing
 * at all. Every such gap routes through here so the wording is identical
 * everywhere and impossible to mistake for data.
 *
 * Never replace this with an empty table, a zeroed stat, or mock rows.
 */
export function NotWiredYet({ title, className = '' }: { title: string; className?: string }) {
  return (
    <div className={`${ADMIN_CARD} px-5 py-14 text-center ${className}`}>
      <div className="font-admin text-[17px] font-bold text-[#221E1A]">{title}</div>
      <div className="mx-auto mt-1.5 max-w-[420px] text-[13px] leading-relaxed text-[#8A7F75]">
        This screen is built and waiting — the data behind it is still being designed.
        Nothing is missing from your queue.
      </div>
    </div>
  );
}
