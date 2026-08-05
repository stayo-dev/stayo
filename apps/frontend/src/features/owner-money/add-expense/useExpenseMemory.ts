import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { expenseService } from '@features/expenses/api';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import type { AddExpenseData } from '../types';

/**
 * Expense memory for the entry form (ADR-047).
 *
 * With no query it returns what this owner records most often, so the form is
 * useful *before* they type anything. As they type it narrows, matching on
 * both what was bought and who supplied it.
 *
 * Every figure here is computed server-side from the owner's own expenses —
 * this hook performs no financial arithmetic of its own.
 */

export interface MemoryEntry {
  kind: 'TITLE' | 'VENDOR';
  key: string;
  occurrences: number;
  totalSpent: number;
  lastAmount: number;
  averageAmount: number;
  highestAmount: number;
  lastDate: string;
  category: string | null;
  vendorName: string | null;
  paymentMethod: string | null;
  notes: string | null;
  isRecurring: boolean;
  recurringFrequency: string | null;
  receiptCount: number;
  hostelCount: number;
  typicalDayOfMonth: number | null;
  dueAroundNow: boolean;
  summaryLine: string;
  score: number;
}

const DEBOUNCE_MS = 200;

export function useExpenseMemory(rawQuery: string) {
  const session = useOwnerSession();
  const [debounced, setDebounced] = useState(rawQuery.trim());

  useEffect(() => {
    const t = setTimeout(() => setDebounced(rawQuery.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [rawQuery]);

  const query = useQuery({
    queryKey: ['owner', 'expense-memory', debounced],
    queryFn: ({ signal }) => expenseService.getMemory(debounced || undefined, 8, signal) as Promise<any>,
    enabled: session.isAuthenticated,
    staleTime: 60_000,
    placeholderData: (prev: unknown) => prev as any,
  });

  return {
    entries: (query.data?.entries ?? []) as MemoryEntry[],
    dueNow: (query.data?.dueNow ?? []) as MemoryEntry[],
    isLoading: query.isLoading,
  };
}

/**
 * Turn a remembered expense into form values.
 *
 * Uses the **last** amount rather than the average: the owner is about to
 * correct it anyway, and the last real figure is a truer starting point than a
 * computed number that never actually occurred. Fields the owner has never
 * filled stay empty rather than being invented.
 */
export function applyMemory(entry: MemoryEntry): Partial<AddExpenseData> {
  return {
    title: entry.kind === 'TITLE' ? entry.key : (entry.vendorName ?? entry.key),
    amount: entry.lastAmount ? String(entry.lastAmount) : '',
    category: entry.category ?? '',
    vendor: entry.vendorName ?? (entry.kind === 'VENDOR' ? entry.key : ''),
    paymentMethod: entry.paymentMethod ?? '',
    notes: entry.notes ?? '',
    recurring: entry.isRecurring,
  };
}
