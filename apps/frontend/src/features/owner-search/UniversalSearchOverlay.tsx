import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, X, Phone, MessageCircle, Copy, Wallet, ChevronRight } from 'lucide-react';
import { cn } from '@shared/lib/cn';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useUniversalSearch } from './useUniversalSearch';
import { quickActionsFor, phoneDigits, type SearchResult } from './searchActions';

const TONE_CLASSES: Record<string, string> = {
  neutral: 'bg-muted text-muted-foreground',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
};

const ACTION_ICON = {
  call: Phone,
  whatsapp: MessageCircle,
  copy: Copy,
  collect: Wallet,
  profile: ChevronRight,
} as const;

function ResultSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-2xl border border-border bg-card p-3.5">
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function ResultRow({
  result,
  onNavigate,
  onCollect,
}: {
  result: SearchResult;
  onNavigate: (href: string) => void;
  onCollect: (result: SearchResult) => void;
}) {
  const actions = quickActionsFor(result);

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <button
        type="button"
        onClick={() => onNavigate(result.href)}
        className="flex w-full items-center gap-3 p-3.5 text-left"
      >
        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[14.5px] font-bold text-foreground">{result.title}</div>
          <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{result.subtitle}</div>
        </div>
        {result.meta && (
          <span
            className={cn(
              'flex-none rounded-full px-2 py-0.5 text-[10.5px] font-bold',
              TONE_CLASSES[result.metaTone ?? 'neutral'],
            )}
          >
            {result.meta}
          </span>
        )}
      </button>

      {actions.length > 0 && (
        // Work happens here, without opening the profile first.
        <div className="flex items-stretch gap-1 border-t border-border/60 px-2 py-1.5">
          {actions.map((action) => {
            const Icon = ACTION_ICON[action.id];
            const className =
              'flex min-h-[38px] flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-[11.5px] font-semibold text-muted-foreground transition-colors hover:bg-muted active:bg-muted';

            if (action.href) {
              return (
                <a key={action.id} href={action.href} target="_blank" rel="noreferrer" className={className}>
                  <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                  {action.label}
                </a>
              );
            }

            return (
              <button
                key={action.id}
                type="button"
                className={className}
                onClick={() => {
                  if (action.id === 'copy') {
                    const digits = phoneDigits(String(result.data?.phone ?? ''));
                    navigator.clipboard
                      ?.writeText(digits)
                      .then(() => stayoToast.success('Number copied'))
                      .catch(() => stayoToast.error('Could not copy the number'));
                    return;
                  }
                  if (action.id === 'collect') return onCollect(result);
                  onNavigate(result.href);
                }}
              >
                <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Universal search (ADR-044) — the owner's "I know who I need" entry point.
 *
 * Full-screen on purpose: on a 430px phone a dropdown fights the keyboard, and
 * the results are the task, not a hint. Groups and their order come from the
 * server, and each result carries its own `href`, so a provider added later
 * (payments, complaints, staff) renders here with **no change to this file**.
 */
export function UniversalSearchOverlay({
  open,
  onClose,
  onCollect,
}: {
  open: boolean;
  onClose: () => void;
  onCollect?: (result: SearchResult) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const { groups, isLoading, state, isError } = useUniversalSearch(query);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    // Focus on the next frame — focusing during the open transition is what
    // makes some Android keyboards fail to appear.
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const go = (href: string) => {
    onClose();
    navigate(href);
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background sm:mx-auto sm:max-w-[480px]">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
        <div className="flex flex-1 items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
          <Search className="h-4 w-4 flex-none text-muted-foreground" strokeWidth={1.8} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tenant, room, phone or hostel"
            aria-label="Search tenants, rooms and hostels"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-foreground outline-none placeholder:text-muted-foreground"
          />
          {query && (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="flex-none">
              <X className="h-4 w-4 text-muted-foreground" strokeWidth={2} />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex-none px-1 py-2 font-display text-[13px] font-bold text-primary"
        >
          Cancel
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-24 pt-4">
        {state === 'idle' && (
          <p className="pt-10 text-center text-[12.5px] leading-relaxed text-muted-foreground">
            Search by tenant name, phone number,
            <br />
            room number or hostel.
          </p>
        )}

        {state === 'too-short' && (
          <p className="pt-10 text-center text-[12.5px] text-muted-foreground">Keep typing…</p>
        )}

        {state === 'loading' && <ResultSkeleton />}

        {state === 'empty' && (
          <div className="pt-10 text-center">
            <p className="font-display text-[14px] font-bold text-foreground">Nothing matches "{query.trim()}"</p>
            <p className="mt-1 text-[12px] text-muted-foreground">Try a phone number, room number or hostel name.</p>
          </div>
        )}

        {isError && (
          <p className="pt-10 text-center text-[12.5px] text-destructive">
            Search is unavailable right now. Please try again.
          </p>
        )}

        {state === 'results' && (
          <div className="flex flex-col gap-5">
            {groups.map((group) => (
              <section key={group.type} className="flex flex-col gap-2">
                <h2 className="pl-0.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </h2>
                {group.results.map((result) => (
                  <ResultRow
                    key={`${result.type}-${result.id}`}
                    result={result}
                    onNavigate={go}
                    onCollect={(r) => {
                      onClose();
                      onCollect?.(r);
                    }}
                  />
                ))}
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
