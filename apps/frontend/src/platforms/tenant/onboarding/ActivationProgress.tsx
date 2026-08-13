import { Check } from 'lucide-react';
import './ActivationProgress.css';

/**
 * The "live journey track" — ported to match `Stayo Onboarding.dc.html`'s
 * flow header exactly: 5 icon nodes (Welcome/Agreement/Identity/Account/Move
 * In), a filling connector line, and a small bobbing avatar above whichever
 * node is active. Previous version of this component used a 4-pill text
 * tracker that didn't match the design source at all — rebuilt 2026-08-13
 * after direct comparison against the actual rendered `.dc.html` file.
 */
export type ActivationVisualStep = 'ACCOUNT' | 'RULES' | 'AGREEMENT' | 'PROFILE' | 'ACTIVATE' | 'MOVE_IN';

type NodeSpec = { id: Exclude<ActivationVisualStep, 'RULES'>; label: string; paths: string[] };

const ALL_NODES: NodeSpec[] = [
  { id: 'ACCOUNT', label: 'Welcome', paths: ['M3 11l9-8 9 8', 'M5 10v10h14V10'] },
  { id: 'AGREEMENT', label: 'Agreement', paths: ['M7 3h7l4 4v14H7z', 'M14 3v4h4M10 12h5M10 16h5'] },
  { id: 'PROFILE', label: 'Identity', paths: ['M12 8m-4 0a4 4 0 1 0 8 0a4 4 0 1 0 -8 0', 'M4.5 20c0-4 3.8-6 7.5-6s7.5 2 7.5 6'] },
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

/** Step 1..5's carried item color (none, welcome pack, folder, key fob, keychain) — read from the source's `avatarLook()`. */
const AVATAR_ITEMS: (string | null)[] = [null, '#EBD9C4', '#A45D44', '#2F2F2F', '#E0B15E'];

/**
 * The bobbing walking figure above the active journey node — ported
 * exactly from the design's "WALKING (active, engaged)" sprite (head, hair,
 * body, one animated arm, two animated legs, an optional carried item).
 * `avatarLook()` in the source varies skin/hair/top/arm color and long-hair/
 * skirt by a `gender` selection made in Step 3 — not collected yet at this
 * point in the flow, so this always renders the source's non-female look
 * (the design's own default).
 */
function TrackAvatar({ itemColor }: { itemColor: string | null }) {
  return (
    <div className="ob-track-bob relative" style={{ width: 20, height: 16 }}>
      <div className="absolute rounded-full" style={{ top: 0, left: 6, width: 9, height: 9, background: '#E8B88C' }} />
      <div className="absolute rounded-t-full" style={{ top: -2, left: 5, width: 11, height: 5, background: '#2F2F2F' }} />
      <div className="absolute rounded" style={{ top: 8, left: 4, width: 12, height: 13, borderRadius: 4, background: '#B46A55' }} />
      <div className="ob-track-arm absolute rounded" style={{ top: 9, left: 1, width: 5, height: 11, borderRadius: 3, background: '#A45D44', transformOrigin: 'top' }} />
      <div className="ob-track-leg-b absolute rounded-full" style={{ top: 19, left: 6, width: 4, height: 11, background: '#2F2F2F', transformOrigin: 'top' }} />
      <div className="ob-track-leg-f absolute rounded-full" style={{ top: 19, left: 10, width: 4, height: 11, background: '#3A322C', transformOrigin: 'top' }} />
      {itemColor && (
        <div className="absolute" style={{ top: 13, left: -2, width: 6, height: 7, borderRadius: 1.5, background: itemColor, boxShadow: '0 1px 2px rgba(0,0,0,.25)' }} />
      )}
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
}

export function ActivationProgress({ activeStep, currentStep, completedSteps, onStepClick, agreementRequired = true }: ActivationProgressProps) {
  const nodes = nodesFor(agreementRequired);
  const activeIdx = nodeIndex(activeStep, agreementRequired);
  const reachedIdx = nodeIndex(currentStep, agreementRequired);
  const remaining = nodes.length - 1 - activeIdx;

  const isDone = (id: ActivationVisualStep) => (id === 'AGREEMENT' ? completedSteps.has('AGREEMENT') : completedSteps.has(id)) || nodeIndex(id, agreementRequired) < activeIdx;
  const isActive = (id: ActivationVisualStep) => (id === 'AGREEMENT' ? activeStep === 'RULES' || activeStep === 'AGREEMENT' : activeStep === id);

  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="font-display text-xs font-extrabold" style={{ color: '#A45D44' }}>
          Step {activeIdx + 1} of {nodes.length}
        </span>
        <span className="text-[11px] font-medium" style={{ color: '#5A5147' }}>
          {remaining === 0 ? 'Last step' : `${remaining} step${remaining === 1 ? '' : 's'} left`}
        </span>
      </div>

      <div className="relative mt-3">
        <div className="absolute top-[18px] rounded-full" style={{ left: '10%', right: '10%', height: 4, background: '#E7DCCD' }} />
        <div
          className="absolute top-[18px] rounded-full transition-[width] duration-500 ease-out"
          style={{ left: '10%', height: 4, width: `${(activeIdx / (nodes.length - 1)) * 80}%`, background: 'linear-gradient(90deg,#B46A55,#D2986C)', boxShadow: '0 0 8px rgba(180,106,85,.4)' }}
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
                className="relative flex flex-1 flex-col items-center gap-1"
              >
                <div className="flex h-[18px] items-end justify-center overflow-visible">
                  {active && <TrackAvatar itemColor={AVATAR_ITEMS[activeIdx]} />}
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
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      {node.paths.map((d, i) => (
                        <path key={i} d={d} />
                      ))}
                    </svg>
                  )}
                </span>
                <span className="text-center text-[9.5px] font-bold leading-tight" style={{ color: active ? '#A45D44' : done ? '#1F7A52' : '#9A8F84' }}>
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
