import { useRef, useState } from 'react';
import {
  angleForValue,
  faceLabel,
  parseClockValue,
  pointOnDial,
  readout,
  toStoredValue,
  valueFromPoint,
  type DialMode,
  type DialTime,
} from '@shared/lib/clockDial';

/**
 * A clock face you point at, the way an alarm is set.
 *
 * `<input type="time">` asks someone to know a format and hands them whatever
 * UI their browser happens to ship — different on every phone, and on desktop
 * usually three cramped spinners. A dial asks them to point at a clock, which
 * is an object they already have in their head.
 *
 * Hour first, then minutes, which is the order the question is actually asked
 * — "seven…" then "…thirty". Selecting an hour advances to minutes on its own,
 * so the common case is two taps and no buttons.
 *
 * All the angle maths lives in `clockDial.ts` so it can be tested; this only
 * turns pointer events into coordinates.
 */

const SIZE = 232;
const CENTRE = SIZE / 2;
const RADIUS = SIZE / 2 - 26;

export function ClockDial({
  value,
  onChange,
  label,
}: {
  /** `HH:MM`, 24-hour. */
  value: string;
  onChange: (next: string) => void;
  label: string;
}) {
  const time = parseClockValue(value);
  const [mode, setMode] = useState<DialMode>('hour');
  const faceRef = useRef<SVGSVGElement | null>(null);

  const set = (next: Partial<DialTime>) => onChange(toStoredValue({ ...time, ...next }));

  const pick = (clientX: number, clientY: number, commit: boolean) => {
    const rect = faceRef.current?.getBoundingClientRect();
    if (!rect) return;
    // Coordinates are read in the SVG's own space, so the dial stays accurate
    // whatever the layout scales it to.
    const x = ((clientX - rect.left) / rect.width) * SIZE;
    const y = ((clientY - rect.top) / rect.height) * SIZE;
    const picked = valueFromPoint(x, y, CENTRE, CENTRE, mode);

    if (mode === 'hour') {
      set({ hour: picked });
      // Advancing on release rather than on touch lets someone drag around the
      // face to find the hour without the dial switching under their finger.
      if (commit) setMode('minute');
    } else {
      set({ minute: picked });
    }
  };

  const active = mode === 'hour' ? time.hour : time.minute;
  const hand = pointOnDial(angleForValue(active, mode), RADIUS, CENTRE, CENTRE);

  return (
    <div className="flex flex-col items-center">
      <div className="mb-1 text-[11px] font-bold uppercase tracking-[.06em]" style={{ color: '#8A7F75' }}>
        {label}
      </div>

      {/* The readout doubles as the mode switch — tap the hour to go back to it. */}
      <div className="mb-2 flex items-end gap-1.5">
        <button
          type="button"
          onClick={() => setMode('hour')}
          className="font-display text-[30px] font-extrabold leading-none"
          style={{ color: mode === 'hour' ? '#B46A55' : '#221E1A' }}
        >
          {faceLabel(time.hour)}
        </button>
        <span className="font-display text-[30px] font-extrabold leading-none" style={{ color: '#221E1A' }}>:</span>
        <button
          type="button"
          onClick={() => setMode('minute')}
          className="font-display text-[30px] font-extrabold leading-none"
          style={{ color: mode === 'minute' ? '#B46A55' : '#221E1A' }}
        >
          {String(time.minute).padStart(2, '0')}
        </button>

        <div className="ml-2 flex flex-col gap-0.5">
          {(['AM', 'PM'] as const).map((half) => (
            <button
              key={half}
              type="button"
              onClick={() => set({ meridiem: half })}
              className="rounded-md px-2 py-0.5 text-[11px] font-bold"
              style={{
                background: time.meridiem === half ? '#B46A55' : '#F3EEE7',
                color: time.meridiem === half ? '#FFFFFF' : '#8A7F75',
              }}
            >
              {half}
            </button>
          ))}
        </div>
      </div>

      <svg
        ref={faceRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        width={SIZE}
        height={SIZE}
        role="slider"
        aria-label={`${label} — ${readout(time)} ${time.meridiem}`}
        aria-valuenow={active}
        aria-valuetext={`${readout(time)} ${time.meridiem}`}
        className="touch-none select-none"
        onPointerDown={(event) => {
          (event.target as Element).setPointerCapture?.(event.pointerId);
          pick(event.clientX, event.clientY, false);
        }}
        onPointerMove={(event) => {
          if (event.buttons === 0) return;
          pick(event.clientX, event.clientY, false);
        }}
        onPointerUp={(event) => pick(event.clientX, event.clientY, true)}
      >
        <circle cx={CENTRE} cy={CENTRE} r={CENTRE - 2} fill="#F7F3EF" />

        {/* The hand, drawn under the numerals so it never hides one. */}
        <line x1={CENTRE} y1={CENTRE} x2={hand.x} y2={hand.y} stroke="#B46A55" strokeWidth={2} />
        <circle cx={hand.x} cy={hand.y} r={17} fill="#B46A55" />
        <circle cx={CENTRE} cy={CENTRE} r={3.5} fill="#B46A55" />

        {Array.from({ length: 12 }).map((_, index) => {
          const position = pointOnDial(angleForValue(index, mode === 'hour' ? 'hour' : 'hour'), RADIUS, CENTRE, CENTRE);
          const numeral = mode === 'hour' ? faceLabel(index) : index * 5;
          const selected = mode === 'hour' ? index === time.hour : index * 5 === time.minute;
          return (
            <text
              key={index}
              x={position.x}
              y={position.y}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={13}
              fontWeight={selected ? 800 : 600}
              fill={selected ? '#FFFFFF' : '#5A5147'}
              pointerEvents="none"
            >
              {mode === 'minute' ? String(numeral).padStart(2, '0') : numeral}
            </text>
          );
        })}
      </svg>
    </div>
  );
}
