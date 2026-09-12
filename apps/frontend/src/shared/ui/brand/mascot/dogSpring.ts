/**
 * The damped spring behind every moving part of the Stayo dog.
 *
 * Why not `motion`'s `useSpring`: the rig couples about twenty values (the
 * ears chase the head, each paw rises along its own lean), and they are
 * written straight to SVG attributes every frame. One small integrator the
 * frame loop owns is simpler than coordinating twenty motion values, and it
 * is testable here.
 *
 * Semi-implicit Euler, sub-stepped so a long frame (a tab coming back from
 * the background) cannot blow the spring up.
 *
 * PURE — no DOM, runs under vitest's node environment.
 */
export interface SpringState {
  x: number;
  v: number;
}

/** Longest single integration step, in seconds. */
const MAX_STEP = 1 / 120;

/**
 * @param k stiffness — higher is snappier
 * @param zeta damping ratio — below 1 overshoots a little, 1 never does
 * @param dt seconds since the last frame
 */
export function stepSpring(state: SpringState, target: number, k: number, zeta: number, dt: number): SpringState {
  const c = 2 * zeta * Math.sqrt(k);
  const steps = Math.max(1, Math.ceil(dt / MAX_STEP));
  const h = dt / steps;
  let { x, v } = state;
  for (let i = 0; i < steps; i++) {
    v += (-k * (x - target) - c * v) * h;
    x += v * h;
  }
  return { x, v };
}
