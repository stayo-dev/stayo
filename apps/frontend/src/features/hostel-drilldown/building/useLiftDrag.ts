import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Pick a thing up, move it, put it down — the gesture behind arranging the
 * building (ADR-206).
 *
 * The building packs four room tiles across a phone, so the tiles cover most
 * of the screen. Making them drag on contact would leave nowhere to scroll
 * from, and a `touch-action: none` grid is a page an owner cannot get past.
 * So a touch has to *commit* first: press and hold, and the tile lifts (with a
 * haptic tick where the device offers one). Anything shorter, or any movement
 * before the hold completes, is a scroll and the tile never moves.
 *
 * A mouse needs no such ceremony — there is no scroll to disambiguate from, so
 * a press lifts immediately.
 *
 * Why not `motion/react`'s `Reorder`: it resolves one axis, and rooms sit in a
 * grid that wraps. The geometry is `arrangeModel`'s `dropIndex`; this hook only
 * reports where the pointer is.
 */

/** How long a finger must rest on a tile before it lifts. */
const HOLD_MS = 220;
/** Movement that cancels the hold, in px — a scroll, not a press. */
const SLOP_PX = 8;

export interface LiftDragHandlers {
  /** Fired once the press is committed. */
  onLift: () => void;
  /** Pointer position while lifted, in client coordinates. */
  onMove: (x: number, y: number) => void;
  /** Released, wherever it ended up. */
  onDrop: () => void;
  /** The gesture was abandoned — Escape, or the pointer was cancelled. */
  onCancel: () => void;
  disabled?: boolean;
}

export function useLiftDrag({ onLift, onMove, onDrop, onCancel, disabled }: LiftDragHandlers) {
  const [lifted, setLifted] = useState(false);
  /** Read by the container's non-passive `touchmove` listener, which cannot see state. */
  const liftedRef = useRef(false);
  const timer = useRef(0);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const captured = useRef<{ el: Element; pointerId: number } | null>(null);

  const clear = useCallback(() => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = 0;
    }
    origin.current = null;
    if (captured.current) {
      try {
        (captured.current.el as HTMLElement).releasePointerCapture(captured.current.pointerId);
      } catch {
        /* the pointer is already gone */
      }
      captured.current = null;
    }
    liftedRef.current = false;
    setLifted(false);
  }, []);

  useEffect(() => clear, [clear]);

  const lift = useCallback(() => {
    liftedRef.current = true;
    setLifted(true);
    try {
      navigator.vibrate?.(8);
    } catch {
      /* vibration is a courtesy, never a requirement */
    }
    onLift();
  }, [onLift]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (disabled || event.button !== 0) return;
      origin.current = { x: event.clientX, y: event.clientY };
      const el = event.currentTarget;
      const pointerId = event.pointerId;
      try {
        el.setPointerCapture(pointerId);
        captured.current = { el, pointerId };
      } catch {
        /* capture is an optimisation; the gesture still works without it */
      }
      if (event.pointerType === 'mouse') {
        lift();
        return;
      }
      timer.current = window.setTimeout(lift, HOLD_MS);
    },
    [disabled, lift],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!origin.current) return;
      if (liftedRef.current) {
        onMove(event.clientX, event.clientY);
        return;
      }
      // Still deciding: movement this early means the owner is scrolling.
      const dx = event.clientX - origin.current.x;
      const dy = event.clientY - origin.current.y;
      if (dx * dx + dy * dy > SLOP_PX * SLOP_PX) clear();
    },
    [clear, onMove],
  );

  const onPointerUp = useCallback(() => {
    const wasLifted = liftedRef.current;
    clear();
    if (wasLifted) onDrop();
  }, [clear, onDrop]);

  const onPointerCancel = useCallback(() => {
    const wasLifted = liftedRef.current;
    clear();
    if (wasLifted) onCancel();
  }, [clear, onCancel]);

  const abort = useCallback(() => {
    const wasLifted = liftedRef.current;
    clear();
    if (wasLifted) onCancel();
  }, [clear, onCancel]);

  return {
    lifted,
    liftedRef,
    abort,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}

/**
 * Stop the page scrolling under a lifted tile.
 *
 * `touch-action` is read when a gesture begins, so flipping it once the tile
 * has lifted comes too late for the touch already in progress. A non-passive
 * `touchmove` listener is the one thing that still works mid-gesture. It lives
 * on the arrange container rather than on each of a hundred tiles.
 */
export function useSuppressScrollWhileLifted(
  ref: React.RefObject<HTMLElement | null>,
  isLifted: () => boolean,
) {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const block = (event: TouchEvent) => {
      if (isLifted()) event.preventDefault();
    };
    node.addEventListener('touchmove', block, { passive: false });
    return () => node.removeEventListener('touchmove', block);
  }, [ref, isLifted]);
}
