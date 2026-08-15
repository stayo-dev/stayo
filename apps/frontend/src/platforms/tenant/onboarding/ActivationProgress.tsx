import { Check } from 'lucide-react';
import './onboarding.css';

/**
 * The "live journey track" — ported to match `Stayo Onboarding.dc.html`'s
 * flow header: 5 icon nodes (Welcome/Identity/Agreement/Account/Move In), a
 * filling connector line, and a small avatar above whichever node is active.
 * Identity precedes Agreement (ADR-070).
 *
 * The avatar has the design's two states: it **walks** while the tenant is
 * engaged, and **sits down and dozes** (`bored`) once `ActivationLayout`'s
 * idle timer fires — plus the design's `avatarLook()` variation, which
 * re-skins hair/top/arm and adds long hair + a skirt once the tenant has
 * picked a gender on the Identity step, and hands them a different carried
 * item at each stage of the journey.
 */
export type ActivationVisualStep = 'ACCOUNT' | 'RULES' | 'AGREEMENT' | 'PROFILE' | 'ACTIVATE' | 'MOVE_IN';

type NodeSpec = { id: Exclude<ActivationVisualStep, 'RULES'>; label: string; paths: string[] };

const ALL_NODES: NodeSpec[] = [
  { id: 'ACCOUNT', label: 'Welcome', paths: ['M3 11l9-8 9 8', 'M5 10v10h14V10'] },
  { id: 'PROFILE', label: 'Identity', paths: ['M12 8m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0', 'M4.5 20c0-4 3.8-6 7.5-6s7.5 2 7.5 6'] },
  { id: 'AGREEMENT', label: 'Agreement', paths: ['M7 3h7l4 4v14H7z', 'M14 3v4h4M10 12h5M10 16h5'] },
  { id: 'ACTIVATE', label: 'Account', paths: ['M5 10h14v10H5z', 'M8 10V7a4 4 0 0 1 8 0v3'] },
  { id: 'MOVE_IN', label: 'Move In', paths: ['M4 21h16', 'M6 21V6a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v15', 'M13 12h.5'] },
];

/**
 * Hostels that do not require a signed agreement (`agreement_required`
 * false, ADR-059) never reach RULES or AGREEMENT — drop that node so the
 * track doesn't show a pip that can never light up.
 */
const nodesFor = (agreementRequired: boolean): NodeSpec[] => (agreementRequired ? ALL_NODES : ALL_NODES.filter((n) => n.id !== 'AGREEMENT'));

function nodeIndex(step: ActivationVisualStep, agreementRequired = true): number {
  const nodes = nodesFor(agreementRequired);
  const key = step === 'RULES' ? 'AGREEMENT' : step;
  const idx = nodes.findIndex((n) => n.id === key);
  return idx === -1 ? 0 : idx;
}

/** Step 1..5's carried item color (none, welcome pack, folder, key fob, keychain) — from the source's `avatarLook()`. */
const AVATAR_ITEMS: (string | null)[] = [null, '#EBD9C4', '#A45D44', '#2F2F2F', '#E0B15E'];

type AvatarLook = { skin: string; hair: string; longHair: boolean; top: string; arm: string; skirt: boolean; itemColor: string | null };

/** `avatarLook()` from the design source — everything but `item` keys off the gender picked on Identity. */
function avatarLook(gender: string, stepIndex: number): AvatarLook {
  const female = (gender || '').toLowerCase().startsWith('female');
  return {
    skin: '#E8B88C',
    hair: female ? '#3A2A22' : '#2F2F2F',
    longHair: female,
    top: female ? '#A45D44' : '#B46A55',
    arm: female ? '#8F4E39' : '#A45D44',
    skirt: female,
    itemColor: AVATAR_ITEMS[Math.min(stepIndex, AVATAR_ITEMS.length - 1)],
  };
}

/** The design's "WALKING (active, engaged)" sprite. */
function WalkingAvatar({ look }: { look: AvatarLook }) {
  return (
    <div className="ob-track-bob relative" style={{ width: 20, height: 16 }}>
      <div className="absolute rounded-full" style={{ top: 0, left: 6, width: 9, height: 9, background: look.skin }} />
      <div className="absolute rounded-t-full" style={{ top: -2, left: 5, width: 11, height: 5, background: look.hair }} />
      {look.longHair && (
        <>
          <div className="absolute" style={{ top: 2, left: 4, width: 3, height: 8, borderRadius: 2, background: look.hair }} />
          <div className="absolute" style={{ top: 2, left: 14, width: 3, height: 8, borderRadius: 2, background: look.hair }} />
        </>
      )}
      <div className="absolute" style={{ top: 8, left: 4, width: 12, height: 13, borderRadius: 4, background: look.top }} />
      {look.skirt && (
        <div className="absolute" style={{ top: 16, left: 2, width: 16, height: 9, background: look.top, clipPath: 'polygon(30% 0,70% 0,100% 100%,0 100%)' }} />
      )}
      <div className="ob-track-arm absolute" style={{ top: 9, left: 1, width: 5, height: 11, borderRadius: 3, background: look.arm, transformOrigin: 'top' }} />
      <div className="ob-track-leg-b absolute rounded-full" style={{ top: 19, left: 6, width: 4, height: 11, background: '#2F2F2F', transformOrigin: 'top' }} />
      <div className="ob-track-leg-f absolute rounded-full" style={{ top: 19, left: 10, width: 4, height: 11, background: '#3A322C', transformOrigin: 'top' }} />
      {look.itemColor && (
        <div className="absolute" style={{ top: 13, left: -2, width: 6, height: 7, borderRadius: 1.5, background: look.itemColor, boxShadow: '0 1px 2px rgba(0,0,0,.25)' }} />
      )}
    </div>
  );
}

/** The design's "BORED / SITTING (idle too long)" sprite. */
function SittingAvatar({ look }: { look: AvatarLook }) {
  return (
    <div className="ob-track-breathe relative" style={{ width: 22, height: 18, transformOrigin: 'bottom center' }}>
      <div className="absolute" style={{ top: 13, left: 2, width: 14, height: 5, background: '#2F2F2F', borderRadius: 3 }} />
      <div className="absolute" style={{ top: 14, left: 14, width: 6, height: 4, background: '#3A322C', borderRadius: 3 }} />
      <div className="absolute" style={{ top: 5, left: 5, width: 11, height: 11, borderRadius: 4, background: look.top, transform: 'rotate(6deg)' }} />
      <div className="absolute rounded-full" style={{ top: 1, left: 6, width: 9, height: 9, background: look.skin, transform: 'rotate(10deg)' }} />
      <div className="absolute rounded-t-full" style={{ top: -1, left: 5, width: 11, height: 5, background: look.hair, transform: 'rotate(10deg)' }} />
      {look.longHair && <div className="absolute" style={{ top: 3, left: 14, width: 3, height: 7, borderRadius: 2, background: look.hair }} />}
      <div className="absolute" style={{ top: 9, left: 2, width: 5, height: 6, borderRadius: 3, background: look.arm, transform: 'rotate(28deg)' }} />
      <div className="ob-track-zzz absolute font-display text-[7px] font-extrabold" style={{ top: -4, left: 15, color: '#8A7F75' }}>
        z
      </div>
    </div>
  );
}

interface ActivationProgressProps {
  activeStep: ActivationVisualStep;
  /** How far the tenant has actually got — bounds what is clickable. */
  currentStep: ActivationVisualStep;
  completedSteps: Set<string>;
  onStepClick: (step: ActivationVisualStep) => void;
  agreementRequired?: boolean;
  /** True once the flow has been idle long enough — swaps the walking avatar for the dozing one. */
  bored?: boolean;
  /** Gender picked on the Identity step; re-skins the avatar per the design's `avatarLook()`. */
  gender?: string;
}

export function ActivationProgress({
  activeStep,
  currentStep,
  completedSteps,
  onStepClick,
  agreementRequired = true,
  bored = false,
  gender = '',
}: ActivationProgressProps) {
  const nodes = nodesFor(agreementRequired);
  const activeIdx = nodeIndex(activeStep, agreementRequired);
  const reachedIdx = nodeIndex(currentStep, agreementRequired);
  const remaining = nodes.length - 1 - activeIdx;
  const look = avatarLook(gender, activeIdx);

  const isDone = (id: ActivationVisualStep) => (id === 'AGREEMENT' ? completedSteps.has('AGREEMENT') : completedSteps.has(id)) || nodeIndex(id, agreementRequired) < activeIdx;
  const isActive = (id: ActivationVisualStep) => (id === 'AGREEMENT' ? activeStep === 'RULES' || activeStep === 'AGREEMENT' : activeStep === id);

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="font-display text-xs font-extrabold" style={{ color: '#A45D44' }}>
          Step {activeIdx + 1} of {nodes.length}
        </span>
        <span className="text-[11px] font-medium" style={{ color: '#5A5147' }}>
          {`${remaining} step${remaining === 1 ? '' : 's'} left`}
        </span>
      </div>

      <div className="relative mt-[11px]">
        <div className="absolute top-[39px] rounded-full" style={{ left: '10%', right: '10%', height: 4, background: '#E7DCCD' }} />
        <div
          className="absolute top-[39px] rounded-full transition-[width] duration-[450ms] ease-out"
          style={{
            left: '10%',
            height: 4,
            width: `${(activeIdx / (nodes.length - 1)) * 80}%`,
            background: 'linear-gradient(90deg,#B46A55,#D2986C)',
            boxShadow: '0 0 8px rgba(180,106,85,.4)',
          }}
        />

        <div className="flex">
          {nodes.map((node) => {
            const done = isDone(node.id);
            const active = isActive(node.id);
            const clickable = nodeIndex(node.id, agreementRequired) <= reachedIdx;

            return (
              <button
                key={node.id}
                type="button"
                disabled={!clickable}
                onClick={() => onStepClick(node.id === 'AGREEMENT' && (currentStep === 'RULES' || currentStep === 'AGREEMENT') ? currentStep : node.id)}
                className="relative flex flex-1 flex-col items-center"
              >
                {/*
                 * The design nests the sprite's absolutely-positioned parts inside an
                 * unpositioned wrapper, so they resolve against this 18px row (their
                 * coordinates are row-relative) and the bob/breathe transform on the
                 * sprite moves nothing. Making the sprite itself the positioning
                 * context is what actually animates it; `items-start` keeps the parts
                 * on the design's coordinate origin while doing so.
                 */}
                <div className="flex h-[18px] items-start justify-center overflow-visible">
                  {active && (bored ? <SittingAvatar look={look} /> : <WalkingAvatar look={look} />)}
                </div>
                <span
                  className="relative z-[1] flex h-7 w-7 items-center justify-center rounded-full transition-all"
                  style={{
                    background: active ? '#B46A55' : done ? '#1F9D57' : '#F1EAE0',
                    border: active ? '2px solid #B46A55' : done ? '2px solid #1F9D57' : '2px solid #E2D8CA',
                    boxShadow: active ? '0 4px 12px rgba(180,106,85,.4)' : 'none',
                    color: active || done ? '#fff' : '#B29C88',
                  }}
                >
                  {done ? (
                    <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  ) : (
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                      {node.paths.map((d, i) => (
                        <path key={i} d={d} />
                      ))}
                    </svg>
                  )}
                </span>
                <span className="mt-[5px] text-center text-[9.5px] font-bold leading-[1.15]" style={{ color: active ? '#A45D44' : done ? '#1F7A52' : '#9A8F84' }}>
                  {node.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export { nodeIndex as activationVisualIndex };
