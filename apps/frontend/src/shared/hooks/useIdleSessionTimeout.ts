import { useCallback, useEffect, useRef, useState } from 'react';
import api from '@lib/api-client';

/**
 * Seven days idle, not thirty minutes — and the warning five minutes before it.
 *
 * Thirty minutes meant an owner signing in ten to twenty times a day. They run
 * a hostel; they are not sitting at a desk. The friction was constant and what
 * it bought was small, because the idle timeout is **not** what guards the
 * dangerous actions: changing rent, changing payment frequency, and cancelling
 * or waiving an obligation each require a fresh two-minute step-up token, so a
 * live session cannot move money on its own.
 *
 * Must stay in step with the server, which enforces the real rule in
 * `middleware.ts` — this hook only decides when to *warn*. A client that
 * expired later than the server would show a working screen that 401s on the
 * next request.
 */
const SESSION_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_WARNING_MS = SESSION_TIMEOUT_MS - 5 * 60 * 1000;
const ACTIVITY_PING_MS = 4 * 60 * 1000;

interface UseIdleSessionTimeoutOptions {
  /** Whether there's currently a signed-in session to watch for inactivity on. */
  isActive: boolean;
  /** Called once the 30-minute inactivity window elapses without user activity. */
  onIdleTimeout: () => void;
}

interface UseIdleSessionTimeoutResult {
  /** True once the user has been inactive long enough to show the "you'll be signed out soon" warning. */
  showIdleWarning: boolean;
  /** Call when the user chooses "Stay signed in" on the warning — resets the idle clock and pings the server. */
  staySignedIn: () => void;
}

/**
 * Client-side inactivity detection for authenticated sessions: warns at 25
 * minutes of no activity, signs out at 30, and sends a lightweight activity
 * heartbeat (`POST /auth/activity`) at most every 4 minutes while a session
 * is active. Extracted out of AuthContext so the two concerns — "is there a
 * session" vs. "has the user gone idle" — aren't bundled into one component.
 *
 * This hook does NOT listen for the `hms:session-expired` event (token
 * refresh failure, reuse detection, max-age) — that's a server-driven signal
 * unrelated to client-side idle detection and stays owned by AuthContext.
 */
export function useIdleSessionTimeout({
  isActive,
  onIdleTimeout,
}: UseIdleSessionTimeoutOptions): UseIdleSessionTimeoutResult {
  const [showIdleWarning, setShowIdleWarning] = useState(false);
  const idleWarningRef = useRef(false);
  const lastActivityPingRef = useRef(0);
  const lastTimerResetRef = useRef(0);

  useEffect(() => {
    idleWarningRef.current = showIdleWarning;
  }, [showIdleWarning]);

  const pingActivity = useCallback(
    (force = false) => {
      if (!isActive) return;
      const now = Date.now();
      if (!force && now - lastActivityPingRef.current < ACTIVITY_PING_MS) return;
      lastActivityPingRef.current = now;

      const send = () => {
        api.post('/auth/activity').catch(() => {
          /* response interceptor handles expired sessions */
        });
      };

      if ('requestIdleCallback' in window) {
        window.requestIdleCallback(send, { timeout: 3000 });
      } else {
        window.setTimeout(send, 0);
      }
    },
    [isActive],
  );

  useEffect(() => {
    if (!isActive) return;

    let warningTimer: number | undefined;
    let logoutTimer: number | undefined;
    let heartbeatTimer: number | undefined;

    const clearTimers = () => {
      window.clearTimeout(warningTimer);
      window.clearTimeout(logoutTimer);
    };

    const resetTimers = () => {
      setShowIdleWarning(false);
      clearTimers();
      warningTimer = window.setTimeout(() => setShowIdleWarning(true), SESSION_WARNING_MS);
      logoutTimer = window.setTimeout(onIdleTimeout, SESSION_TIMEOUT_MS);
    };

    const onActivity = () => {
      const now = Date.now();
      if (!idleWarningRef.current && now - lastTimerResetRef.current < 10_000) {
        pingActivity();
        return;
      }
      lastTimerResetRef.current = now;
      resetTimers();
      pingActivity();
    };

    const events = ['mousemove', 'keydown', 'touchstart', 'pointerdown', 'visibilitychange'];
    events.forEach((eventName) => window.addEventListener(eventName, onActivity, { passive: true }));
    resetTimers();
    heartbeatTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') pingActivity();
    }, ACTIVITY_PING_MS);

    return () => {
      clearTimers();
      window.clearInterval(heartbeatTimer);
      events.forEach((eventName) => window.removeEventListener(eventName, onActivity));
    };
  }, [isActive, onIdleTimeout, pingActivity]);

  const staySignedIn = useCallback(() => {
    setShowIdleWarning(false);
    try {
      pingActivity(true);
    } catch {
      /* response interceptor handles expired sessions */
    }
  }, [pingActivity]);

  return { showIdleWarning, staySignedIn };
}
