import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { playSuccessFeedback } from '@shared/ui-patterns/successFeedback';
import { buildConfetti, confettiDurationMs } from '@shared/ui-patterns/confetti';

interface ImportCelebrationProps {
  /** How many tenants landed. Only ever rendered for a clean finish — see `celebrationFor`. */
  tenants: number;
}

const PIECES = buildConfetti();

/**
 * The moment an import lands.
 *
 * An owner who has just moved a hostel's worth of residents onto Stayo has
 * done the largest single thing the app asks of them, and a line of grey text
 * saying "Import complete" undersold it. This is the same confirmation the
 * five money-and-commitment screens use — the Stayo sound and the two-pulse
 * haptic, through `playSuccessFeedback` — with the onboarding confetti and a
 * check that draws itself.
 *
 * Plays **once**, on mount. The screen underneath keeps re-rendering while
 * invitations go out, and a sound on every render would be noise.
 *
 * Under `prefers-reduced-motion` the check is drawn already finished and no
 * confetti falls; the sound and haptic still play, for the reason
 * `successFeedback` gives — they answer a button the owner pressed, and that
 * setting is about motion.
 */
export function ImportCelebration({ tenants }: ImportCelebrationProps) {
  const reduceMotion = useReducedMotion();
  const played = useRef(false);
  const [confetti, setConfetti] = useState(!reduceMotion);

  useEffect(() => {
    if (played.current) return;
    played.current = true;
    playSuccessFeedback();
  }, []);

  // Take the layer down once the last piece has landed — forty-six absolutely
  // positioned spans have no business outliving their animation.
  useEffect(() => {
    if (!confetti) return;
    const timer = window.setTimeout(() => setConfetti(false), confettiDurationMs(PIECES) + 200);
    return () => window.clearTimeout(timer);
  }, [confetti]);

  const animate = !reduceMotion;

  return (
    <div className="flex flex-col items-center py-2 text-center" role="status" aria-live="polite">
      <motion.div
        className="relative h-16 w-16"
        initial={animate ? { scale: 0.4, opacity: 0 } : false}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 16 }}
      >
        {animate && (
          <motion.span
            aria-hidden
            className="absolute inset-0 rounded-full bg-[#1F8A5B]/25"
            initial={{ scale: 0.8, opacity: 0.7 }}
            animate={{ scale: 1.7, opacity: 0 }}
            transition={{ duration: 1.1, delay: 0.2, ease: 'easeOut' }}
          />
        )}
        <svg viewBox="0 0 64 64" className="relative h-16 w-16" aria-hidden>
          <circle cx="32" cy="32" r="30" fill="#1F8A5B" />
          <motion.path
            d="M19 33.5 L28 42 L45.5 23.5"
            fill="none"
            stroke="white"
            strokeWidth="5"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={animate ? { pathLength: 0 } : false}
            animate={{ pathLength: 1 }}
            transition={{ duration: 0.45, delay: 0.25, ease: 'easeOut' }}
          />
        </svg>
      </motion.div>

      <motion.div
        initial={animate ? { opacity: 0, y: 8 } : false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, delay: 0.45 }}
      >
        <p className="mt-3 font-display text-[17px] font-bold text-foreground">
          {tenants === 1 ? '1 tenant imported' : `${tenants.toLocaleString('en-IN')} tenants imported`}
        </p>
        <p className="mt-1 text-[12.5px] font-medium text-muted-foreground">
          {tenants === 1
            ? 'Their rent is being tracked from their joining date.'
            : 'Rent for each of them is tracked from their joining date.'}
        </p>
      </motion.div>

      {confetti && (
        <div className="pointer-events-none fixed inset-0 z-[80] overflow-hidden" aria-hidden>
          {PIECES.map((p) => (
            <span
              key={p.id}
              className="absolute -top-5"
              style={
                {
                  left: `${p.left}%`,
                  width: p.size,
                  height: p.size + 2,
                  background: p.color,
                  borderRadius: p.round,
                  '--stayo-confetti-rot': p.rot,
                  animation: `stayoConfettiFall ${p.dur}s linear ${p.delay}s forwards`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
