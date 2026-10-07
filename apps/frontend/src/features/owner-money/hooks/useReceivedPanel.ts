import { useEffect, useMemo, useState } from 'react';
import { periodRange, type ReceivedMethodFilter, type ReceivedPeriod } from '../components/collections/received';
import { useRentReceived } from './useRentReceived';

/**
 * The Received view's filters and data, held by the page so the Collections
 * toggle can show the received total before the owner switches to it.
 *
 * `hostelFilter` is the Money page's own scope. "Business (HQ)" has no rent, so
 * it widens to every hostel — the same rule the payment-claims card follows.
 */
export function useReceivedPanel(hostelFilter: string, enabled: boolean) {
  const [period, setPeriod] = useState<ReceivedPeriod>('month');
  const [method, setMethod] = useState<ReceivedMethodFilter>('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const hostelId = hostelFilter && hostelFilter !== 'all' && hostelFilter !== 'business' ? hostelFilter : null;
  // Recomputed per render on purpose: "today" must roll over at midnight on a
  // screen left open. The memo key is the resulting strings, not the Date.
  const { from, to } = periodRange(period);
  const params = useMemo(
    () => ({ hostelId, from, to, method: method === 'all' ? null : method, q: debounced }),
    [hostelId, from, to, method, debounced],
  );

  const data = useRentReceived(params, enabled);

  return {
    period,
    setPeriod,
    method,
    setMethod,
    search,
    setSearch,
    /** True when the list is narrowed by something other than the period. */
    isFiltered: method !== 'all' || debounced !== '',
    spansHostels: hostelId == null,
    ...data,
  };
}

export type ReceivedPanelState = ReturnType<typeof useReceivedPanel>;
