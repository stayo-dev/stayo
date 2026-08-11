import type { CSSProperties } from 'react';

/**
 * The illustrated world behind a hostel-setup flow: the building rising
 * floor-by-floor, windows appearing and lighting up as rooms and beds are
 * configured, the owner walking on site, sun rays and students at the end.
 *
 * Ported from `Owner Onboarding.dc.html`'s `sv` scene model, but driven by
 * *what is true about the hostel* rather than by a wizard step index. It
 * previously read `step >= 7` to draw windows and `step >= 8` to light them,
 * which welded the artwork to one screen's step numbering — so the same
 * animation could not be reused by the Add Hostel builder, where "floors
 * exist" and "this floor's rooms are set" are real states rather than
 * positions in a 12-step sequence.
 *
 * Purely decorative and stateless: every prop is derived by the caller.
 */

/** More storeys than this are not drawn — the building would leave the frame. */
export const MAX_DRAWN_FLOORS = 6;

export interface HostelSceneState {
  /** Shown on the signboard. */
  hostelName: string;
  /** How far the owner figure has walked in: 0 far, 1 mid, 2 on site. */
  approach: 0 | 1 | 2;
  /** Reveals the living world at all — birds, grass, the owner. */
  sceneStarted: boolean;
  /** Green tick on the owner (identity verified). */
  ownerVerified: boolean;
  /** The hostel has a name, so the signboard drops in. */
  showSign: boolean;
  /** Road, plot and neighbouring building. */
  showSite: boolean;
  /** The location pin — only while the site is being chosen. */
  showPin: boolean;
  /** Storeys drawn, floor by floor. Clamped to MAX_DRAWN_FLOORS. */
  floorsBuilt: number;
  /** Scaffolding poles, ground platform and dust puffs. */
  underConstruction: boolean;
  showRoof: boolean;
  /** Window density per storey — more rooms, more windows. */
  roomsPerFloor: number;
  /** Windows are cut into the walls (rooms exist). */
  showWindows: boolean;
  /** Windows glow and beds appear inside them (rooms are furnished). */
  litWindows: boolean;
  showChimney: boolean;
  /** Green verification badge on the building. */
  showBadge: boolean;
  /** Sun rays, chimney smoke and students arriving. */
  celebrate: boolean;
  ownerWaving: boolean;
}

function reveal(cond: boolean, delay = '0ms', fromY = 12): CSSProperties {
  return {
    opacity: cond ? 1 : 0,
    transform: cond ? 'none' : `translateY(${fromY}px)`,
    transition: `opacity .7s ease ${delay}, transform .8s cubic-bezier(.2,.8,.2,1) ${delay}`,
  };
}

const RAY_LIST = Array.from({ length: 12 }, (_, i) => ({ rot: i * 30, y: -6 }));

export function HostelScene(props: HostelSceneState) {
  const {
    hostelName,
    approach,
    sceneStarted,
    ownerVerified,
    showSign,
    showSite,
    showPin,
    floorsBuilt,
    underConstruction,
    showRoof,
    roomsPerFloor,
    showWindows,
    litWindows,
    showChimney,
    showBadge,
    celebrate,
    ownerWaving,
  } = props;

  const cx = 820;
  const bw = 210;
  const fh = 46;
  const groundY = 560;
  const N = Math.min(MAX_DRAWN_FLOORS, Math.max(0, floorsBuilt));
  const winN = Math.min(4, Math.max(2, Math.round(roomsPerFloor / 3)));

  const floors = Array.from({ length: N }, (_, i) => {
    const top = groundY - (i + 1) * fh;
    const isGround = i === 0;
    const gap = bw / (winN + 1);
    const windows = Array.from({ length: winN }, (_, w) => {
      const wx = Math.round(cx - bw / 2 + gap * (w + 1) - 9);
      return {
        x: wx,
        y: top + 12,
        fill: litWindows ? '#F7C873' : '#EFE0CE',
        op: showWindows ? 1 : 0,
        bx: wx + 3,
        by: top + 27,
        bedOp: litWindows ? 1 : 0,
        bedTf: litWindows ? 'translateY(0)' : 'translateY(7px)',
        bedDelay: `${w * 70}ms`,
      };
    });
    return { x: cx - bw / 2, y: top, w: bw, h: fh, fill: isGround ? '#9A5540' : '#AF6650', isGround, doorY: top + fh - 34, windows, style: reveal(true, `${i * 90}ms`, 20) };
  });

  const apexY = groundY - N * fh - 40;
  const baseY = groundY - N * fh;
  const roof = `${cx},${apexY} ${cx - bw / 2 - 10},${baseY} ${cx + bw / 2 + 10},${baseY}`;
  const signW = Math.max(96, Math.min(190, hostelName.length * 9 + 26));
  const ownerShift = approach === 0 ? -74 : approach === 1 ? -44 : 0;
  const chimY = apexY - 16;
  const smokeY = apexY - 24;

  const pathStyle: CSSProperties = {
    strokeDasharray: 360,
    strokeDashoffset: showSite ? 0 : 360,
    transition: 'stroke-dashoffset 1.3s ease .2s',
    opacity: showSite ? 1 : 0,
  };
  const pinStyle: CSSProperties =
    showPin
      ? { animation: 'stayoDropPin .6s cubic-bezier(.3,1.3,.5,1) both', opacity: 1 }
      : { opacity: 0, transition: 'opacity .6s ease' };
  const signStyle: CSSProperties = showSign ? { animation: 'stayoDropPin .6s cubic-bezier(.3,1.3,.5,1) both', opacity: 1 } : { opacity: 0, transition: 'opacity .4s' };
  const badgeStyle: CSSProperties = showBadge ? { animation: 'stayoDropPin .7s cubic-bezier(.3,1.3,.5,1) both', opacity: 1 } : { opacity: 0, transition: 'opacity .4s' };

  return (
    <div className="pointer-events-none fixed inset-0 z-0 [filter:saturate(1.03)_blur(0.6px)]">
      <svg viewBox="0 0 1200 820" preserveAspectRatio="xMidYMid slice" className="block h-full w-full">
        <defs>
          <linearGradient id="stayo-sky" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#FCEFE3" />
            <stop offset="1" stopColor="#FBE4D4" />
          </linearGradient>
          <radialGradient id="stayo-sun" cx="0.5" cy="0.5" r="0.5">
            <stop offset="0" stopColor="#FFEBCB" />
            <stop offset="0.55" stopColor="#FFE0B4" />
            <stop offset="1" stopColor="rgba(255,224,180,0)" />
          </radialGradient>
          <linearGradient id="stayo-body" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#BE6E51" />
            <stop offset="1" stopColor="#9C5038" />
          </linearGradient>
          <filter id="stayo-fuzz" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
          <filter id="stayo-haze" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.4" />
          </filter>
        </defs>

        <rect x="0" y="0" width="1200" height="820" fill="url(#stayo-sky)" />

        <g fill="#FFFFFF" opacity="0.8">
          <g style={{ transform: 'translate(180px,120px)' }}>
            <g style={{ animation: 'stayoCloudDrift 20s ease-in-out infinite' }}>
              <ellipse cx="0" cy="0" rx="42" ry="20" />
              <ellipse cx="34" cy="6" rx="30" ry="16" />
              <ellipse cx="-32" cy="6" rx="26" ry="14" />
            </g>
          </g>
          <g style={{ transform: 'translate(560px,78px)' }}>
            <g style={{ animation: 'stayoCloudDrift 26s ease-in-out infinite 2s' }}>
              <ellipse cx="0" cy="0" rx="36" ry="17" />
              <ellipse cx="30" cy="5" rx="24" ry="13" />
              <ellipse cx="-28" cy="5" rx="22" ry="12" />
            </g>
          </g>
          <g style={{ transform: 'translate(940px,150px)' }}>
            <g style={{ animation: 'stayoCloudDrift 23s ease-in-out infinite 1s' }}>
              <ellipse cx="0" cy="0" rx="30" ry="15" />
              <ellipse cx="24" cy="5" rx="20" ry="11" />
              <ellipse cx="-22" cy="4" rx="18" ry="10" />
            </g>
          </g>
        </g>

        <circle cx="1010" cy="150" r="150" fill="url(#stayo-sun)" style={{ animation: 'stayoSunGlow 7s ease-in-out infinite' }} />
        <circle cx="1010" cy="150" r="52" fill="#FFE7C2" />
        <g style={reveal(celebrate)}>
          <g style={{ transformOrigin: '1010px 150px', animation: 'stayoSpinSlow 90s linear infinite' }}>
            {RAY_LIST.map((r, i) => (
              <rect key={i} x="1006" y={r.y} width="8" height="18" rx="4" fill="#FBD59A" transform={`rotate(${r.rot} 1010 150)`} />
            ))}
          </g>
        </g>

        <g style={reveal(sceneStarted)} stroke="#8A6A55" strokeWidth="2.4" fill="none" strokeLinecap="round">
          <g style={{ transform: 'translate(300px,150px)' }}>
            <g style={{ animation: 'stayoBirdFly 15s linear infinite' }}>
              <path d="M0 0 q7 -7 14 0 q7 -7 14 0" />
            </g>
          </g>
          <g style={{ transform: 'translate(360px,192px)' }}>
            <g style={{ animation: 'stayoBirdFly 15s linear infinite 1.4s' }}>
              <path d="M0 0 q5 -5 10 0 q5 -5 10 0" />
            </g>
          </g>
          <g style={{ transform: 'translate(700px,118px)' }}>
            <g style={{ animation: 'stayoBirdFly 19s linear infinite 3s' }}>
              <path d="M0 0 q6 -6 12 0 q6 -6 12 0" />
            </g>
          </g>
        </g>

        <g filter="url(#stayo-fuzz)" opacity="0.7">
          <ellipse cx="300" cy="600" rx="440" ry="150" fill="#F0D8C4" />
          <ellipse cx="900" cy="620" rx="480" ry="160" fill="#EDD2BB" />
        </g>
        <g filter="url(#stayo-haze)" opacity="0.9">
          <ellipse cx="150" cy="640" rx="360" ry="130" fill="#E9CDB2" />
          <ellipse cx="1080" cy="650" rx="360" ry="130" fill="#E7C9AC" />
        </g>

        <rect x="0" y="560" width="1200" height="260" fill="#ECDAC7" />

        <g style={reveal(showSite, '.1s', 10)} filter="url(#stayo-haze)" opacity="0.55">
          <rect x="1044" y="486" width="86" height="74" rx="4" fill="#C79A82" />
          <polygon points="1087,462 1040,488 1134,488" fill="#B07E66" />
          <rect x="1058" y="506" width="14" height="16" rx="2" fill="#F0DFC8" />
          <rect x="1082" y="506" width="14" height="16" rx="2" fill="#F0DFC8" />
          <rect x="1058" y="530" width="14" height="16" rx="2" fill="#F0DFC8" />
          <rect x="1082" y="530" width="14" height="16" rx="2" fill="#F0DFC8" />
        </g>

        <ellipse cx="820" cy="580" rx="230" ry="40" fill="#E4CFB6" />
        <path d="M0 596 Q400 576 760 592 T1200 588" stroke="rgba(140,96,72,.10)" strokeWidth="2" fill="none" />

        <g style={reveal(sceneStarted, '0ms', 6)} fill="none">
          {[
            { x: 150, y: 592, delay: '0s' },
            { x: 360, y: 596, delay: '.4s' },
            { x: 585, y: 600, delay: '.2s' },
            { x: 1030, y: 598, delay: '.6s' },
            { x: 1105, y: 596, delay: '.1s' },
          ].map((g) => (
            <g key={g.x} style={{ transformOrigin: `${g.x}px ${g.y}px`, animation: `stayoSway 5.8s ease-in-out infinite ${g.delay}` }}>
              <path d={`M${g.x} ${g.y} v-12M${g.x - 5} ${g.y} v-9M${g.x + 5} ${g.y} v-9`} stroke="#9DB07E" strokeWidth="2.4" strokeLinecap="round" />
            </g>
          ))}
        </g>

        <g style={pathStyle}>
          <path d="M596 566 Q700 606 812 568" stroke="#E6D0B8" strokeWidth="30" fill="none" strokeLinecap="round" />
          <path d="M596 566 Q700 606 812 568" stroke="#D8BE9F" strokeWidth="30" fill="none" strokeLinecap="round" strokeDasharray="2 26" opacity="0.55" />
        </g>

        <g style={pinStyle}>
          <path
            d="M700 500 C684 500 672 512 672 528 C672 548 700 566 700 566 C700 566 728 548 728 528 C728 512 716 500 700 500 Z"
            fill="#A45D44"
          />
          <circle cx="700" cy="527" r="10" fill="#FBEFE9" />
        </g>

        <g style={reveal(showSign, '.1s', 8)}>
          <rect x="656" y="576" width="330" height="9" rx="4" fill="#D8BE9F" />
          <rect x="662" y="570" width="7" height="16" rx="3" fill="#C7A987" />
          <rect x="740" y="570" width="7" height="16" rx="3" fill="#C7A987" />
          <rect x="818" y="570" width="7" height="16" rx="3" fill="#C7A987" />
          <rect x="896" y="570" width="7" height="16" rx="3" fill="#C7A987" />
          <rect x="974" y="570" width="7" height="16" rx="3" fill="#C7A987" />
        </g>

        <g style={reveal(underConstruction)}>
          <rect x="699" y="554" width="242" height="14" rx="3" fill="#B7A488" />
        </g>
        <g style={{ opacity: underConstruction ? 1 : 0 }}>
          <ellipse cx="740" cy="558" rx="16" ry="6" fill="#D8C6AE" style={{ animation: 'stayoDustPuff 2.4s ease-out infinite' }} />
          <ellipse cx="828" cy="560" rx="18" ry="6" fill="#D8C6AE" style={{ animation: 'stayoDustPuff 2.4s ease-out infinite .8s' }} />
          <ellipse cx="906" cy="558" rx="15" ry="6" fill="#D8C6AE" style={{ animation: 'stayoDustPuff 2.4s ease-out infinite 1.5s' }} />
        </g>
        <g style={reveal(underConstruction, '.15s', 14)} fill="#8E7A62">
          <rect x="716" y="420" width="9" height="140" rx="3" />
          <rect x="778" y="420" width="9" height="140" rx="3" />
          <rect x="853" y="420" width="9" height="140" rx="3" />
          <rect x="915" y="420" width="9" height="140" rx="3" />
        </g>

        {/* BUILDING */}
        <g>
          <polygon points={roof} fill="#8A4A34" style={reveal(showRoof, `${N * 90}ms`, 16)} />
          <g style={reveal(showChimney)}>
            <rect x="856" y={chimY} width="16" height="30" rx="2" fill="#8A4A34" />
          </g>
          <g style={{ opacity: celebrate ? 1 : 0, transition: 'opacity .3s' }}>
            <circle cx="864" cy={smokeY} r="7" fill="#E7D8C4" style={{ animation: 'stayoSmokePuff 3s ease-out infinite' }} />
            <circle cx="864" cy={smokeY} r="6" fill="#E7D8C4" style={{ animation: 'stayoSmokePuff 3s ease-out infinite 1.2s' }} />
            <circle cx="864" cy={smokeY} r="5" fill="#E7D8C4" style={{ animation: 'stayoSmokePuff 3s ease-out infinite 2.1s' }} />
          </g>
          {floors.map((f, fi) => (
            <g key={fi} style={f.style}>
              <rect x={f.x} y={f.y} width={f.w} height={f.h} fill={f.fill} />
              {f.windows.map((w, wi) => (
                <g key={wi}>
                  <rect x={w.x} y={w.y} width="18" height="22" rx="4" style={{ fill: w.fill, opacity: w.op, transition: 'fill .6s ease, opacity .5s ease' }} />
                  <rect
                    x={w.bx}
                    y={w.by}
                    width="12"
                    height="5"
                    rx="2"
                    style={{ fill: '#9A4F38', opacity: w.bedOp, transform: w.bedTf, transition: `opacity .5s ease ${w.bedDelay}, transform .5s ease ${w.bedDelay}` }}
                  />
                </g>
              ))}
              {f.isGround && <rect x="808" y={f.doorY} width="26" height="34" rx="5" fill="#F0DCC2" />}
            </g>
          ))}
          <g style={reveal(showBadge)}>
            <circle cx="900" cy={apexY + 10} r="17" fill="#1F8A5B" style={badgeStyle} />
            <path d={`M892 ${apexY + 10} l6 6 l10 -12`} stroke="#fff" strokeWidth="3.2" fill="none" strokeLinecap="round" strokeLinejoin="round" style={badgeStyle} />
          </g>
        </g>

        <g style={signStyle}>
          <rect x="818" y="540" width="5" height="28" rx="2" fill="#8A5A3E" />
          <rect x={cx - signW / 2} y="520" width={signW} height="28" rx="6" fill="#FFFFFF" />
          <rect x={cx - signW / 2} y="520" width={signW} height="28" rx="6" fill="none" stroke="rgba(47,47,47,.1)" />
          <text x="820" y="538" textAnchor="middle" fontFamily="Manrope,sans-serif" fontWeight="800" fontSize="14" fill="#A45D44">
            {hostelName}
          </text>
        </g>

        <g style={reveal(showChimney, '0ms', 14)}>
          <g style={{ transformOrigin: '635px 560px', animation: 'stayoSway 6s ease-in-out infinite' }}>
            <rect x="631" y="536" width="8" height="30" rx="4" fill="#8A5A3E" />
            <circle cx="635" cy="524" r="20" fill="#7FA36B" />
            <circle cx="624" cy="534" r="14" fill="#8DB079" />
            <circle cx="647" cy="533" r="13" fill="#8DB079" />
          </g>
          <g style={{ transformOrigin: '990px 560px', animation: 'stayoSway 7s ease-in-out infinite .5s' }}>
            <rect x="986" y="532" width="9" height="34" rx="4" fill="#8A5A3E" />
            <circle cx="990" cy="518" r="23" fill="#7FA36B" />
            <circle cx="976" cy="530" r="15" fill="#8DB079" />
            <circle cx="1004" cy="530" r="14" fill="#8DB079" />
          </g>
        </g>

        <g style={reveal(celebrate, '.2s', 0)}>
          <g style={{ animation: 'stayoStudentIn .7s ease both' }}>
            <g style={{ transformOrigin: '648px 592px', animation: 'stayoSway 4.4s ease-in-out infinite' }}>
              <ellipse cx="648" cy="594" rx="13" ry="4" fill="rgba(90,58,40,.12)" />
              <rect x="643" y="566" width="10" height="26" rx="5" fill="#B86A4E" />
              <circle cx="648" cy="558" r="8" fill="#EAC7A3" />
            </g>
          </g>
          <g style={{ animation: 'stayoStudentIn .7s ease .15s both' }}>
            <g style={{ transformOrigin: '690px 594px', animation: 'stayoSway 4s ease-in-out infinite .3s' }}>
              <ellipse cx="690" cy="596" rx="13" ry="4" fill="rgba(90,58,40,.12)" />
              <rect x="685" y="568" width="10" height="26" rx="5" fill="#C98A5A" />
              <circle cx="690" cy="560" r="8" fill="#E6C09B" />
            </g>
          </g>
          <g style={{ animation: 'stayoStudentIn .7s ease .3s both' }}>
            <g style={{ transformOrigin: '732px 592px', animation: 'stayoSway 4.6s ease-in-out infinite .5s' }}>
              <ellipse cx="732" cy="594" rx="13" ry="4" fill="rgba(90,58,40,.12)" />
              <rect x="727" y="566" width="10" height="26" rx="5" fill="#7FA36B" />
              <circle cx="732" cy="558" r="8" fill="#EAC7A3" />
            </g>
          </g>
        </g>

        {/* OWNER */}
        <g style={{ transform: `translate(${120 + ownerShift}px,0)`, transition: 'transform 1.1s cubic-bezier(.3,.8,.3,1)' }}>
          <g style={reveal(sceneStarted, '.1s', 18)}>
            <g style={{ transformOrigin: '540px 548px', animation: 'stayoSway 7s ease-in-out infinite' }}>
              <ellipse cx="540" cy="552" rx="36" ry="9" fill="rgba(90,58,40,.12)" />
              <rect x="524" y="522" width="12" height="28" rx="6" fill="#6E4636" />
              <rect x="544" y="522" width="12" height="28" rx="6" fill="#6E4636" />
              <rect x="512" y="474" width="12" height="42" rx="6" fill="#A85B41" />
              <g style={ownerWaving ? { transformOrigin: '562px 478px', animation: 'stayoOwnerWave 1s ease-in-out infinite' } : { transformOrigin: '562px 478px' }}>
                <rect x="556" y="474" width="12" height="42" rx="6" fill="#A85B41" />
              </g>
              <rect x="516" y="470" width="48" height="58" rx="22" fill="url(#stayo-body)" />
              <circle cx="540" cy="440" r="19" fill="#EAC7A3" />
              <path d="M521 438 a19 19 0 0 1 38 0 l0 -3 a19 19 0 0 0 -38 0 Z" fill="#4A3428" />
              <rect x="521" y="422" width="38" height="14" rx="9" fill="#4A3428" />
              <circle cx="534" cy="440" r="1.8" fill="#3A2E28" />
              <circle cx="546" cy="440" r="1.8" fill="#3A2E28" />
              <g style={ownerVerified ? { animation: 'stayoPopIn .5s cubic-bezier(.3,1.4,.5,1) both', opacity: 1 } : { opacity: 0, transition: 'opacity .3s' }}>
                <circle cx="566" cy="424" r="11" fill="#1F8A5B" />
                <path d="M560 424 l4 4 l7 -8" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </g>
              <g style={ownerVerified ? { animation: 'stayoSparkleBurst 1s ease-out .2s both' } : { opacity: 0 }} fill="#F4C67A">
                <path d="M584 410 l1.6 3.4 l3.4 1.6 l-3.4 1.6 l-1.6 3.4 l-1.6 -3.4 l-3.4 -1.6 l3.4 -1.6 Z" />
                <path d="M556 404 l1.1 2.4 l2.4 1.1 l-2.4 1.1 l-1.1 2.4 l-1.1 -2.4 l-2.4 -1.1 l2.4 -1.1 Z" />
              </g>
            </g>
          </g>
        </g>
      </svg>
    </div>
  );
}
