/**
 * How the Stayo dog feels to use. Tuned on the rig-bench prototype
 * (docs/superpowers/specs/2026-09-12-stayo-dog-mascot-design.md, "Tuning")
 * and signed off at these values. Change them there first: the numbers
 * interact, and the prototype is where they were judged together.
 */
export const DOG_TUNING = {
  pupilRange: 3, //         svg units
  headTiltMax: 6, //        degrees
  headStiffness: 170, //    spring k
  headDamping: 0.72, //     damping ratio ζ
  earFollow: 0.45, //       × head stiffness — low is floppy
  pawStiffness: 220, //     spring k
  wagHz: 2.5, //            Hz
  blinkEveryS: 4, //        s, plus random 0–4 s
  errorHoldMs: 2400, //     ms
  successBeatMs: 600, //    ms, 0 under reduced motion
  idleSleepS: 30, //        s
} as const;
