import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'stayo_mock_owner_journey';

interface MockOwnerLead {
  name: string;
  email: string;
  hostelName?: string;
  ownerName?: string;
  phone?: string;
}

interface MockOwnerJourneyState {
  authenticated: boolean;
  activated: boolean;
  lead: MockOwnerLead | null;
}

interface MockOwnerJourneyValue extends MockOwnerJourneyState {
  startSession: (lead: MockOwnerLead) => void;
  updateLead: (patch: Partial<MockOwnerLead>) => void;
  activate: () => void;
  reset: () => void;
}

const EMPTY_STATE: MockOwnerJourneyState = { authenticated: false, activated: false, lead: null };

function readStoredState(): MockOwnerJourneyState {
  if (typeof window === 'undefined') return EMPTY_STATE;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_STATE;
    const parsed = JSON.parse(raw);
    return {
      authenticated: Boolean(parsed.authenticated),
      activated: Boolean(parsed.activated),
      lead: parsed.lead ?? null,
    };
  } catch {
    return EMPTY_STATE;
  }
}

function writeStoredState(state: MockOwnerJourneyState) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // sessionStorage unavailable (private mode, etc.) — mock journey just won't survive a reload.
  }
}

const MockOwnerJourneyContext = createContext<MockOwnerJourneyValue | null>(null);

/**
 * Session for the demo-only owner acquisition journey (Landing → Login →
 * Lead Submitted → Activation → Onboarding → Dashboard preview). Deliberately
 * decoupled from the real `AuthContext`/`ProtectedRoute` — this journey never
 * calls the backend, so it can't populate a real session. Modeled on how the
 * design source itself gates `Owner Onboarding.dc.html` (a `localStorage`
 * flag, independent of any server), just using `sessionStorage` and a
 * `stayo_mock_*`-prefixed key so it's never confused with real session state.
 */
export function MockOwnerJourneyProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<MockOwnerJourneyState>(() => readStoredState());

  const startSession = useCallback((lead: MockOwnerLead) => {
    setState(() => {
      const next = { authenticated: true, activated: false, lead };
      writeStoredState(next);
      return next;
    });
  }, []);

  const updateLead = useCallback((patch: Partial<MockOwnerLead>) => {
    setState((prev) => {
      if (!prev.lead) return prev;
      const next = { ...prev, lead: { ...prev.lead, ...patch } };
      writeStoredState(next);
      return next;
    });
  }, []);

  const activate = useCallback(() => {
    setState((prev) => {
      const next = { ...prev, activated: true };
      writeStoredState(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    writeStoredState(EMPTY_STATE);
    setState(EMPTY_STATE);
  }, []);

  const value = useMemo<MockOwnerJourneyValue>(
    () => ({ ...state, startSession, updateLead, activate, reset }),
    [state, startSession, updateLead, activate, reset],
  );

  return <MockOwnerJourneyContext.Provider value={value}>{children}</MockOwnerJourneyContext.Provider>;
}

export function useMockOwnerJourney() {
  const ctx = useContext(MockOwnerJourneyContext);
  if (!ctx) throw new Error('useMockOwnerJourney must be used within MockOwnerJourneyProvider');
  return ctx;
}
