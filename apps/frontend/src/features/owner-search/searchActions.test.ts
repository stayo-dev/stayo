import { describe, expect, it } from 'vitest';
import {
  phoneDigits,
  whatsAppNumber,
  quickActionsFor,
  countResults,
  viewState,
  type SearchResult,
  type SearchGroup,
} from './searchActions';

function tenant(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    type: 'TENANT',
    id: 't1',
    title: 'Rahul Sharma',
    subtitle: 'Room 203 · MG Road',
    meta: '₹8,000 overdue',
    href: '/owner/tenants/t1',
    score: 100,
    data: { phone: '9876543210', outstanding: 8000, invited: false },
    ...overrides,
  };
}

const ids = (r: SearchResult) => quickActionsFor(r).map((a) => a.id);

describe('phoneDigits', () => {
  it('strips formatting', () => {
    expect(phoneDigits('+91 98765 43210')).toBe('919876543210');
    expect(phoneDigits(null)).toBe('');
  });
});

describe('whatsAppNumber', () => {
  it('prefixes a bare 10-digit Indian number', () => {
    expect(whatsAppNumber('9876543210')).toBe('919876543210');
  });

  it('keeps an already-prefixed number as is', () => {
    expect(whatsAppNumber('+91 98765 43210')).toBe('919876543210');
  });

  it('refuses a number it cannot confidently prefix', () => {
    // Better no button than one that opens a chat with the wrong person.
    expect(whatsAppNumber('12345')).toBeNull();
    expect(whatsAppNumber('447700900000')).toBeNull();
    expect(whatsAppNumber('')).toBeNull();
    expect(whatsAppNumber(null)).toBeNull();
  });
});

describe('quickActionsFor — availability', () => {
  it('offers the full set for a reachable tenant who owes money', () => {
    expect(ids(tenant())).toEqual(['call', 'whatsapp', 'copy', 'collect', 'profile']);
  });

  it('drops Collect when nothing is owed', () => {
    expect(ids(tenant({ data: { phone: '9876543210', outstanding: 0, invited: false } }))).not.toContain('collect');
  });

  it('drops Collect for an invited tenant even if a figure exists', () => {
    // They have not activated — the collect flow would have nothing in it.
    const r = tenant({ data: { phone: '9876543210', outstanding: 5000, invited: true } });
    expect(ids(r)).not.toContain('collect');
  });

  it('drops Call, WhatsApp and Copy when there is no phone number', () => {
    const r = tenant({ data: { phone: '', outstanding: 8000, invited: false } });
    expect(ids(r)).toEqual(['collect', 'profile']);
  });

  it('drops WhatsApp but keeps Call for an unprefixable number', () => {
    const r = tenant({ data: { phone: '12345', outstanding: 0, invited: false } });
    expect(ids(r)).toContain('call');
    expect(ids(r)).not.toContain('whatsapp');
  });

  it('always offers Profile as the fallback', () => {
    const r = tenant({ data: {} });
    expect(ids(r)).toContain('profile');
  });

  it('offers no inline actions for hostels or rooms', () => {
    expect(quickActionsFor(tenant({ type: 'HOSTEL' }))).toEqual([]);
    expect(quickActionsFor(tenant({ type: 'ROOM' }))).toEqual([]);
  });

  it('offers nothing for an unknown future type rather than guessing', () => {
    expect(quickActionsFor(tenant({ type: 'COMPLAINT' }))).toEqual([]);
  });
});

describe('quickActionsFor — links', () => {
  it('builds a dialable tel: link', () => {
    const call = quickActionsFor(tenant()).find((a) => a.id === 'call');
    expect(call?.href).toBe('tel:+919876543210');
  });

  it('builds a wa.me link with country code', () => {
    const wa = quickActionsFor(tenant()).find((a) => a.id === 'whatsapp');
    expect(wa?.href).toBe('https://wa.me/919876543210');
  });

  it('gives in-app actions no href', () => {
    const actions = quickActionsFor(tenant());
    expect(actions.find((a) => a.id === 'collect')?.href).toBeUndefined();
    expect(actions.find((a) => a.id === 'copy')?.href).toBeUndefined();
  });
});

describe('countResults', () => {
  const g = (n: number): SearchGroup => ({
    type: 'TENANT',
    label: 'Tenants',
    order: 1,
    results: Array.from({ length: n }, (_, i) => tenant({ id: `t${i}` })),
  });

  it('sums across groups', () => {
    expect(countResults([g(2), g(3)])).toBe(5);
  });

  it('handles no groups', () => {
    expect(countResults([])).toBe(0);
  });
});

describe('viewState', () => {
  const groups = [{ type: 'TENANT', label: 'Tenants', order: 1, results: [tenant()] }] as SearchGroup[];

  it('is idle with no query', () => {
    expect(viewState({ query: '', isLoading: false, groups: undefined })).toBe('idle');
    expect(viewState({ query: '   ', isLoading: false, groups: undefined })).toBe('idle');
  });

  it('asks for more characters below the minimum', () => {
    expect(viewState({ query: 'r', isLoading: false, groups: undefined })).toBe('too-short');
  });

  it('shows results when there are some', () => {
    expect(viewState({ query: 'rahul', isLoading: false, groups })).toBe('results');
  });

  it('shows empty only once loading has finished', () => {
    expect(viewState({ query: 'zzz', isLoading: false, groups: [] })).toBe('empty');
  });

  it('never flashes empty while a request is in flight', () => {
    // The whole point: an owner mid-keystroke must not see "No matches".
    expect(viewState({ query: 'rahul', isLoading: true, groups: [] })).toBe('loading');
    expect(viewState({ query: 'rahul', isLoading: true, groups: undefined })).toBe('loading');
  });

  it('prefers too-short over loading, so a 1-char query never spins', () => {
    expect(viewState({ query: 'r', isLoading: true, groups: undefined })).toBe('too-short');
  });
});
