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
  lastScope?: 'BUSINESS' | 'HOSTEL' | null;
  lastHostelId?: string | null;
  businessCount?: number;
  hostelScopedCount?: number;
}

/**
 * Deterministic (title, vendor) pair with per-pair statistics.
 *
 * This is the key data structure that the current title/vendor queries alone
 * could NOT provide: each row is an observed fact — "this owner bought [title]
 * from [vendor] N times" — with per-pair amount, recency, and payment method.
 *
 * The frontend uses these to nest vendor cards under consolidated title
 * profiles without any heuristic matching.
 */
export interface TitleVendorPair {
  titleKey: string;
  vendorKey: string;
  title: string;
  vendorName: string;
  occurrences: number;
  averageAmount: number;
  lastAmount: number;
  lastDate: string;
  paymentMethod: string | null;
  category: string | null;
  lastScope?: 'BUSINESS' | 'HOSTEL' | null;
  lastHostelId?: string | null;
  businessCount?: number;
  hostelScopedCount?: number;
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
    titleVendors: (query.data?.titleVendors ?? []) as TitleVendorPair[],
    isLoading: query.isLoading,
  };
}

/**
 * "Use this setup" — copy only the purchasing pattern, never the transaction.
 *
 * Copies: title, vendor, category, remembered payment method.
 * Never copies: amount, date, receipt, notes, transaction status.
 *
 * This is the distinction between "I'm using the same purchasing pattern" and
 * "I'm duplicating that old transaction." The owner always enters today's
 * amount fresh.
 */
export function applySetup(entry: MemoryEntry): Partial<AddExpenseData> {
  const hasHostelHistory = Boolean(entry.lastHostelId) || (entry.hostelScopedCount ?? 0) > 0;
  const isHostel = entry.lastScope === 'HOSTEL' || hasHostelHistory;
  return {
    title: entry.kind === 'TITLE' ? entry.key : (entry.vendorName ?? entry.key),
    category: entry.category ?? '',
    vendor: entry.vendorName ?? (entry.kind === 'VENDOR' ? entry.key : ''),
    paymentMethod: entry.paymentMethod ?? '',
    ...(entry.lastScope ? {
      expenseScope: isHostel ? 'HOSTEL' : 'BUSINESS',
      hostelId: isHostel ? (entry.lastHostelId ?? '') : '',
    } : {}),
  };
}

/**
 * Apply a specific title-vendor pair as the setup.
 * Uses the deterministic (title, vendor) relationship from the backend.
 */
export function applyTitleVendorSetup(pair: TitleVendorPair): Partial<AddExpenseData> {
  const isHostel = pair.lastScope === 'HOSTEL';
  return {
    title: pair.title,
    vendor: pair.vendorName,
    category: pair.category ?? '',
    paymentMethod: pair.paymentMethod ?? '',
    ...(pair.lastScope ? {
      expenseScope: isHostel ? 'HOSTEL' : 'BUSINESS',
      hostelId: isHostel ? (pair.lastHostelId ?? '') : '',
    } : {}),
  };
}
