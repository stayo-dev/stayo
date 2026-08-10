import { useState } from 'react';
import { Store, ChevronRight, ChevronDown, ChevronUp, Plus, Building2, Building } from 'lucide-react';
import { EXPENSE_CATEGORIES } from '@shared/mocks/expenses';
import { categoryIcon } from '../../components/expenses/categoryIcons';
import { cn } from '@shared/lib/cn';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import type { AddExpenseData } from '../../types';
import {
  useExpenseMemory,
  applySetup,
  applyTitleVendorSetup,
  type MemoryEntry,
  type TitleVendorPair,
} from '../useExpenseMemory';

interface DetailsStepProps {
  data: AddExpenseData;
  setD: (patch: Partial<AddExpenseData>) => void;
  /** Jump straight to the amount once a remembered expense is reused. */
  onReused?: () => void;
}

/* ── Confidence label ────────────────────────────────────────────── */

function confidenceLabel(occurrences: number): string | null {
  if (occurrences >= 3) return 'Usually purchased from';
  if (occurrences >= 2) return 'Previously purchased from';
  return null;
}

/* ── Vendor card (nested under a title) ──────────────────────────── */

function VendorCard({
  pair,
  onSelect,
}: {
  pair: TitleVendorPair;
  onSelect: () => void;
}) {
  const avg = `₹${Math.round(pair.averageAmount).toLocaleString('en-IN')}`;
  const last = new Date(pair.lastDate);
  const daysAgo = Math.max(0, Math.round((Date.now() - last.getTime()) / 86_400_000));
  const recency =
    daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`;

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-2.5 text-left transition-colors active:bg-muted"
    >
      <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-secondary">
        <Store className="h-3.5 w-3.5 text-primary" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold text-foreground">
          {pair.vendorName}
        </span>
        <span className="block text-[10.5px] text-muted-foreground">
          {avg} typical · {recency}
        </span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 flex-none text-muted-foreground" />
    </button>
  );
}

/* ── Consolidated title profile ──────────────────────────────────── */

function TitleProfile({
  entry,
  vendors,
  onSelectVendor,
  onUseSetup,
  onSelectNoVendor,
}: {
  entry: MemoryEntry;
  vendors: TitleVendorPair[];
  onSelectVendor: (pair: TitleVendorPair) => void;
  onUseSetup: () => void;
  onSelectNoVendor: () => void;
}) {
  const times = `${entry.occurrences} time${entry.occurrences === 1 ? '' : 's'}`;
  const last = new Date(entry.lastDate);
  const daysAgo = Math.max(0, Math.round((Date.now() - last.getTime()) / 86_400_000));
  const recency =
    daysAgo === 0 ? 'today' : daysAgo === 1 ? 'yesterday' : `${daysAgo} days ago`;
  const confidence = vendors.length > 0 ? confidenceLabel(Math.max(...vendors.map((v) => v.occurrences))) : null;

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3">
      {/* Title header — tappable as "Use this setup" when there's a single
          remembered vendor. Shows the item identity and aggregate stats. */}
      <button
        type="button"
        onClick={vendors.length <= 1 ? onUseSetup : undefined}
        className={cn(
          'flex items-center gap-3 text-left',
          vendors.length <= 1 && 'active:opacity-70',
        )}
      >
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[14px] font-bold text-foreground">
            {entry.key}
          </span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            {entry.category && <>{entry.category} · </>}
            Bought {times} · last {recency}
          </span>
        </span>
        {vendors.length <= 1 && (
          <span className="flex flex-none items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1.5 text-[10.5px] font-bold text-primary">
            Use this setup
          </span>
        )}
      </button>

      {/* Vendor cards — only when there are multiple known vendors */}
      {vendors.length > 1 && (
        <div className="flex flex-col gap-1.5 pt-1">
          {confidence && (
            <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
              {confidence}
            </span>
          )}
          {vendors.map((v) => (
            <VendorCard
              key={v.vendorKey}
              pair={v}
              onSelect={() => onSelectVendor(v)}
            />
          ))}
          <button
            type="button"
            onClick={onSelectNoVendor}
            className="flex items-center gap-2 px-1 py-1.5 text-[11.5px] font-semibold text-primary"
          >
            <Plus className="h-3 w-3" strokeWidth={2.5} />
            Different vendor
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Quick-pattern shortcut (empty state) ────────────────────────── */

function PatternShortcut({
  entry,
  onUse,
}: {
  entry: MemoryEntry;
  onUse: () => void;
}) {
  const last = new Date(entry.lastDate);
  const daysAgo = Math.max(0, Math.round((Date.now() - last.getTime()) / 86_400_000));
  const recency =
    daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo}d ago`;

  return (
    <button
      type="button"
      onClick={onUse}
      className={cn(
        'flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors active:bg-muted',
        entry.dueAroundNow ? 'border-primary/40 bg-secondary/40' : 'border-border bg-card',
      )}
    >
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[13.5px] font-bold text-foreground">
          {entry.key}
        </span>
        <span className="mt-0.5 block text-[11px] text-muted-foreground">
          {[entry.vendorName, entry.paymentMethod].filter(Boolean).join(' · ')}
          {entry.vendorName || entry.paymentMethod ? ' · ' : ''}
          Last {recency.toLowerCase()}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" />
    </button>
  );
}

/* ── Category selector (progressive disclosure) ──────────────────── */

function CategorySelector({
  selected,
  onChange,
}: {
  selected: string;
  onChange: (name: string) => void;
}) {
  const [expanded, setExpanded] = useState(!selected);

  if (selected && !expanded) {
    const cat = EXPENSE_CATEGORIES.find((c) => c.name === selected);
    const Icon = cat ? categoryIcon(cat.id) : categoryIcon('other');
    return (
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-primary" strokeWidth={1.75} />
        <span className="text-[12.5px] font-bold text-foreground">{selected}</span>
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="ml-1 text-[11px] font-semibold text-primary"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          Category
        </span>
        {selected && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-muted-foreground"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        {EXPENSE_CATEGORIES.map((c) => {
          const active = selected === c.name;
          const Icon = categoryIcon(c.id);
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => {
                onChange(c.name);
                setExpanded(false);
              }}
              className={cn(
                'flex flex-col items-center gap-2 rounded-2xl border-[1.5px] p-3 text-center transition-colors',
                active ? 'border-primary bg-secondary/50' : 'border-border bg-card',
              )}
            >
              <Icon
                className={cn('h-5 w-5', active ? 'text-primary' : 'text-muted-foreground')}
                strokeWidth={1.75}
              />
              <span
                className={cn(
                  'text-[11px] font-semibold leading-tight',
                  active ? 'text-foreground' : 'text-foreground/80',
                )}
              >
                {c.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ── Ownership Scope Selector ────────────────────────────────────── */

function OwnershipScopeSelector({
  data,
  setD,
}: {
  data: AddExpenseData;
  setD: (patch: Partial<AddExpenseData>) => void;
}) {
  const session = useOwnerSession();
  const hostels = session.hostels ?? [];

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-3.5">
      <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
        Expense Belongs To
      </span>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setD({ expenseScope: 'BUSINESS', hostelId: '' })}
          className={cn(
            'flex flex-col items-center gap-1 rounded-xl border p-2.5 text-center transition-all',
            data.expenseScope === 'BUSINESS'
              ? 'border-primary bg-primary/10 font-bold text-primary'
              : 'border-border bg-background font-medium text-muted-foreground',
          )}
        >
          <Building2 className="h-4 w-4" />
          <span className="text-xs">Business Overall</span>
        </button>
        <button
          type="button"
          onClick={() => {
            const defaultHostel = data.hostelId || session.primaryHostelId || hostels[0]?.id || '';
            setD({ expenseScope: 'HOSTEL', hostelId: defaultHostel });
          }}
          className={cn(
            'flex flex-col items-center gap-1 rounded-xl border p-2.5 text-center transition-all',
            data.expenseScope === 'HOSTEL'
              ? 'border-primary bg-primary/10 font-bold text-primary'
              : 'border-border bg-background font-medium text-muted-foreground',
          )}
        >
          <Building className="h-4 w-4" />
          <span className="text-xs">Specific Hostel</span>
        </button>
      </div>

      {data.expenseScope === 'HOSTEL' && (
        <div className="mt-1 flex flex-col gap-1">
          <span className="text-[10.5px] font-semibold text-muted-foreground">Select Property</span>
          <select
            value={data.hostelId}
            onChange={(e) => setD({ hostelId: e.target.value })}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground focus:border-primary focus:outline-none"
          >
            {!data.hostelId && <option value="">-- Choose Hostel --</option>}
            {hostels.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

/* ── Step 1: "What did you buy?" ─────────────────────────────────── */

/**
 * Step 1/3 of Add Expense — redesigned around the purchase, not the
 * database record.
 *
 * Empty state: shows "Recent & Frequent" pattern shortcuts — the owner's
 * most-repeated expenses as one-tap paths.
 *
 * Typing state: shows consolidated title profiles with nested vendor cards
 * built from the deterministic `titleVendors` API response. No heuristic
 * matching — every vendor association is an observed (title, vendor) fact.
 *
 * "Use this setup" copies only title, vendor, category, and remembered
 * payment method — never amount, date, notes, receipt, or status.
 */
export function DetailsStep({ data, setD, onReused }: DetailsStepProps) {
  const { entries, titleVendors, isLoading } = useExpenseMemory(data.title);

  // Title entries only (patterns the owner buys)
  const titleEntries = entries.filter((e) => e.kind === 'TITLE');

  // Build the vendor lookup: for each normalized title, collect its vendors
  const vendorsByTitle = new Map<string, TitleVendorPair[]>();
  for (const pair of titleVendors) {
    const list = vendorsByTitle.get(pair.titleKey) ?? [];
    list.push(pair);
    vendorsByTitle.set(pair.titleKey, list);
  }

  const isSearching = Boolean(data.title.trim());

  // "Use this setup" from a quick-pattern or single-vendor title
  const handleUseSetup = (entry: MemoryEntry) => {
    setD(applySetup(entry));
    onReused?.();
  };

  // "Select vendor" from a vendor card nested under a title
  const handleSelectVendor = (pair: TitleVendorPair) => {
    setD(applyTitleVendorSetup(pair));
    onReused?.();
  };

  // "Different vendor" — fill the title and category but leave vendor empty
  const handleNoVendor = (entry: MemoryEntry) => {
    setD({
      title: entry.key,
      category: entry.category ?? '',
      vendor: '',
    });
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Ownership Scope Selector */}
      <OwnershipScopeSelector data={data} setD={setD} />

      {/* Search input */}
      <label className="block">
        <span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          What did you buy?
        </span>
        <input
          value={data.title}
          onChange={(e) => setD({ title: e.target.value })}
          placeholder="e.g. Rice purchase, Electricity bill, Staff salary"
          className="w-full rounded-2xl border-[1.5px] border-border bg-card px-4 py-4 text-[15px] font-semibold text-foreground focus:border-primary focus:outline-none"
        />
      </label>

      {/* ── Empty state: pattern shortcuts ───────────────────────── */}
      {!isSearching && (entries.length > 0 || isLoading) && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Recent & Frequent
          </span>
          {isLoading && entries.length === 0 ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-[60px] animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          ) : (
            titleEntries.slice(0, 4).map((entry) => (
              <PatternShortcut
                key={entry.key}
                entry={entry}
                onUse={() => handleUseSetup(entry)}
              />
            ))
          )}
        </div>
      )}

      {/* ── Typing state: consolidated title profiles ────────────── */}
      {isSearching && (titleEntries.length > 0 || isLoading) && (
        <div className="flex flex-col gap-2.5">
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            From your history
          </span>
          {isLoading && titleEntries.length === 0 ? (
            <div className="flex flex-col gap-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-[80px] animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          ) : (
            titleEntries.map((entry) => {
              const key = entry.key.trim().toLowerCase();
              const vendors = vendorsByTitle.get(key) ?? [];
              return (
                <TitleProfile
                  key={key}
                  entry={entry}
                  vendors={vendors}
                  onSelectVendor={handleSelectVendor}
                  onUseSetup={() => handleUseSetup(entry)}
                  onSelectNoVendor={() => handleNoVendor(entry)}
                />
              );
            })
          )}
        </div>
      )}

      {/* ── Vendor input (manual, always available) ──────────────── */}
      {data.title.trim() && (
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Vendor <span className="font-medium normal-case text-muted-foreground/70">(optional)</span>
          </span>
          <input
            value={data.vendor}
            onChange={(e) => setD({ vendor: e.target.value })}
            placeholder="e.g. Sri Rice Shop, Local Market"
            className="w-full rounded-xl border border-border bg-card px-3.5 py-3 text-[13px] font-medium text-foreground focus:border-primary focus:outline-none"
          />
        </label>
      )}

      {/* ── Category selector ───────────────────────────────────── */}
      <CategorySelector
        selected={data.category}
        onChange={(name) => setD({ category: name })}
      />
    </div>
  );
}
