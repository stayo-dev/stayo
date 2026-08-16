import { ADMIN_CARD } from '../theme/palette';

const TONE = {
  ink: 'text-[#221E1A]',
  green: 'text-[#1F7A52]',
  amber: 'text-[#B8792B]',
  red: 'text-[#B3402F]',
} as const;

const DELTA_BG = {
  ink: 'bg-[#F2ECE5]',
  green: 'bg-[#EAF3EE]',
  amber: 'bg-[#FBF1DE]',
  red: 'bg-[#FBEFE9]',
} as const;

export type StatTone = keyof typeof TONE;

export function StatCard({
  label, value, sub, valueTone = 'ink', delta, deltaTone = 'green',
}: {
  label: string;
  value: string;
  sub?: string;
  valueTone?: StatTone;
  delta?: string;
  deltaTone?: StatTone;
}) {
  return (
    <div className={`${ADMIN_CARD} px-[17px] py-[15px]`}>
      <div className="flex items-center justify-between gap-2.5">
        <div className="text-[11.5px] font-semibold text-[#8A7F75]">{label}</div>
        {delta ? (
          <span
            className={`rounded-full px-2 py-[3px] font-display text-[10.5px] font-bold ${TONE[deltaTone]} ${DELTA_BG[deltaTone]}`}
          >
            {delta}
          </span>
        ) : null}
      </div>
      <div className={`mt-1.5 font-display text-[23px] font-extrabold tracking-[-0.02em] ${TONE[valueTone]}`}>
        {value}
      </div>
      {sub ? <div className="mt-px text-[11px] text-[#A2978B]">{sub}</div> : null}
    </div>
  );
}
