/*
 * The Stayo dog's artwork — every variant of every rig part, drawn once.
 *
 * Path data is lifted from `Stayo-Brand-Assetes/MascotStayoDog/*.svg` (their
 * C2PA metadata blocks stripped); do not retrace it by hand. Groups carry a
 * `data-part` name the frame loop in `StayoDog.tsx` finds once and then
 * transforms directly; variant groups carry `data-v` and are shown one at a
 * time. Nothing here re-renders per frame.
 *
 * The palette is the six brand colours plus the tongue, hard-coded like
 * `stayo-loading.css`: the dog is brand art, not themed UI.
 *
 * DERIVED v1 ART — for the designer to refine: the forearms and paw pads
 * (`arm-l`/`arm-r`), the concerned brows, the wobble mouth, the closed-eye
 * cover and the rim paws are built from existing shapes, not the source files.
 */
export const DOG_COLORS = {
  clay: '#B46A55',
  terra: '#A45D44',
  dusty: '#D2986C',
  latte: '#EBD9C4',
  charcoal: '#2F2F2F',
  cream: '#F7F3EE',
  tongue: '#C97B6E',
} as const;

/** Where the card's top edge crosses the dog in `rim` framing, in art units. */
export const RIM_Y = 214;

export type DogFraming = 'rim' | 'full';

const C = DOG_COLORS;
const line = { stroke: C.charcoal, fill: 'none', strokeLinecap: 'round' as const };

function Eye({ side, cx }: { side: 'l' | 'r'; cx: number }) {
  return (
    <g data-part={`eye-${side}`}>
      <g data-v="open">
        <g data-part={`ball-${side}`}>
          <circle cx={cx} cy={112} r={8} fill={C.charcoal} />
          <circle cx={cx + 2.5} cy={109} r={2.4} fill={C.cream} />
        </g>
      </g>
      <path data-v="happy" d={`M${cx - 10} 112 Q${cx} 100 ${cx + 10} 112`} strokeWidth={5} {...line} />
      <path data-v="closed" d={`M${cx - 9} 113 Q${cx} 118 ${cx + 9} 113`} strokeWidth={4} {...line} />
    </g>
  );
}

/** A forearm drawn upright, paw pad `ARM_REACH` (104) above its origin. */
function Arm({ side }: { side: 'l' | 'r' }) {
  return (
    <g data-part={`arm-${side}`}>
      <path d="M-12 80 L-12 -20 C-12 -60 -11 -88 -9 -100 C-6 -114 6 -114 9 -100 C11 -88 12 -60 12 -20 L12 80 Z" fill={C.terra} />
      <ellipse cx={0} cy={-106} rx={15} ry={12} fill={C.latte} />
    </g>
  );
}

function Star({ x, y }: { x: number; y: number }) {
  return <path className="stayo-dog__sparkle" d={`M${x} ${y} l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3 Z`} fill={C.dusty} />;
}

export function DogArt({ clipId, framing }: { clipId: string; framing: DogFraming }) {
  const rim = framing === 'rim';
  return (
    <>
      <defs>
        <clipPath id={clipId}>
          <rect x={-100} y={-100} width={500} height={rim ? RIM_Y + 100 : 500} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clipId})`}>
        <g data-part="rise">
          <g data-part="tail-pivot">
            <g data-part="tail">
              <path data-v="down" d="M205 250 C240 255 255 240 258 215 C260 235 248 268 210 272 Z" fill={C.terra} />
              <path data-v="mid" d="M205 240 C245 230 268 200 262 170 C275 195 268 240 215 258 Z" fill={C.terra} />
              <path data-v="high" d="M200 225 C232 190 260 150 250 115 C275 140 278 205 215 245 Z" fill={C.terra} />
            </g>
          </g>
          <g data-part="torso">
            <path d="M95 300 C90 230 100 190 150 185 C200 190 210 230 205 300 Z" fill={C.clay} />
            <ellipse cx={150} cy={255} rx={34} ry={40} fill={C.latte} />
            {!rim && (
              <>
                <ellipse cx={122} cy={292} rx={16} ry={10} fill={C.latte} />
                <ellipse cx={178} cy={292} rx={16} ry={10} fill={C.latte} />
              </>
            )}
          </g>
          <g data-part="head">
            <g data-part="ear-l">
              <path data-v="rest" d="M96 92 C68 100 58 145 78 185 C90 205 108 200 110 178 C112 150 108 115 96 92 Z" fill={C.terra} />
              <path data-v="perk" d="M100 88 C74 84 60 118 74 158 C86 180 104 172 108 150 C112 128 110 105 100 88 Z" fill={C.terra} />
            </g>
            <g data-part="ear-r">
              <path data-v="rest" d="M204 92 C232 100 242 145 222 185 C210 205 192 200 190 178 C188 150 192 115 204 92 Z" fill={C.terra} />
              <path data-v="perk" d="M200 88 C226 84 240 118 226 158 C214 180 196 172 192 150 C188 128 190 105 200 88 Z" fill={C.terra} />
            </g>
            <circle cx={150} cy={128} r={62} fill={C.clay} />
            <ellipse cx={150} cy={152} rx={36} ry={26} fill={C.latte} />
            <circle cx={150} cy={140} r={7} fill={C.charcoal} />
            <g data-part="brows" strokeWidth={4} {...line}>
              <g data-v="none" />
              <g data-v="raised">
                <path d="M116 92 Q130 84 142 92" />
                <path d="M158 92 Q170 84 184 92" />
              </g>
              <g data-v="curious">
                <path d="M114 88 Q128 74 146 84" />
              </g>
              <g data-v="concerned">
                <path d="M117 96 Q129 90 142 87" />
                <path d="M158 87 Q171 90 183 96" />
              </g>
            </g>
            <Eye side="l" cx={130} />
            <Eye side="r" cx={170} />
            <g data-part="mouth">
              <path data-v="smile" d="M138 158 Q150 168 162 158" strokeWidth={4.5} {...line} />
              <g data-v="pant">
                <path d="M128 156 Q150 182 172 156 Q168 168 150 170 Q132 168 128 156 Z" fill={C.charcoal} />
                <path d="M138 165 C136 190 138 212 150 216 C162 212 164 190 162 165 Z" fill={C.tongue} />
                <path d="M150 172 L150 210" stroke={C.terra} strokeWidth={2} opacity={0.5} />
              </g>
              <g data-v="big">
                <path d="M124 154 Q150 190 176 154 Q170 172 150 176 Q130 172 124 154 Z" fill={C.charcoal} />
                <path d="M136 166 C134 196 138 220 150 224 C162 220 166 196 164 166 Z" fill={C.tongue} />
              </g>
              <path data-v="small" d="M144 160 Q150 164 156 160" strokeWidth={4} {...line} />
              <path data-v="wobble" d="M139 163 Q144.5 158 150 162 Q155.5 166 161 161" strokeWidth={4} {...line} />
            </g>
          </g>
          <Arm side="l" />
          <Arm side="r" />
        </g>
      </g>
      {rim && (
        <g data-part="rim-paws" stroke={C.dusty} strokeWidth={1.5}>
          <ellipse cx={116} cy={RIM_Y} rx={17} ry={10} fill={C.latte} />
          <ellipse cx={184} cy={RIM_Y} rx={17} ry={10} fill={C.latte} />
        </g>
      )}
      <g data-part="bubble">
        <circle cx={220} cy={88} r={5} fill={C.latte} stroke={C.terra} strokeWidth={2} />
        <circle cx={235} cy={70} r={7} fill={C.latte} stroke={C.terra} strokeWidth={2} />
        <ellipse cx={256} cy={45} rx={26} ry={20} fill={C.latte} stroke={C.terra} strokeWidth={2} />
        <g className="stayo-dog__dots">
          <circle cx={248} cy={45} r={3} fill={C.terra} />
          <circle cx={257} cy={45} r={3} fill={C.terra} />
          <circle cx={266} cy={45} r={3} fill={C.terra} />
        </g>
      </g>
      <g data-part="sparkles">
        <Star x={60} y={60} />
        <Star x={240} y={40} />
        <Star x={262} y={128} />
        <Star x={40} y={140} />
      </g>
      <g data-part="zzz" className="stayo-dog__zzz" fontFamily="Manrope, sans-serif" fontWeight={800} fill={C.dusty}>
        <text x={205} y={75} fontSize={22}>z</text>
        <text x={222} y={55} fontSize={17}>z</text>
        <text x={236} y={38} fontSize={13}>z</text>
      </g>
    </>
  );
}
