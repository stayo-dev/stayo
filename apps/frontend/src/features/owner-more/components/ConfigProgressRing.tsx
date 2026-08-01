const RADIUS = 30;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

interface ConfigProgressRingProps {
  percent: number;
}

/** SVG completion ring for the Configuration hub's progress card. */
export function ConfigProgressRing({ percent }: ConfigProgressRingProps) {
  const clamped = Math.max(0, Math.min(100, percent));
  const offset = CIRCUMFERENCE * (1 - clamped / 100);

  return (
    <div className="relative h-[74px] w-[74px] flex-none">
      <svg width="74" height="74" viewBox="0 0 74 74">
        <circle cx="37" cy="37" r={RADIUS} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="7" />
        <circle
          cx="37"
          cy="37"
          r={RADIUS}
          fill="none"
          stroke="#D9906F"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform="rotate(-90 37 37)"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <div className="font-display text-[20px] font-extrabold tracking-tight text-white">
          {clamped}
          <span className="text-[11px]">%</span>
        </div>
      </div>
    </div>
  );
}
