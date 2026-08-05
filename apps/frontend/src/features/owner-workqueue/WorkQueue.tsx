import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, Check, Info } from 'lucide-react';
import { cn } from '@shared/lib/cn';

/**
 * The one work-queue interaction model (ADR-046).
 *
 * Every Action Center card leads here: **card → prioritised queue → one-tap
 * actions → the row leaves the list**. There is deliberately a single
 * implementation rather than four similar screens, because the owner should
 * learn one workflow and meet it everywhere — and because four copies drift.
 *
 * Completion is the row disappearing and the section count dropping. There is
 * no progress bar by explicit product direction.
 *
 * A queue supplies data and actions; it does not get to invent layout,
 * ordering semantics or empty states.
 */

export interface WorkQueueAction {
  id: string;
  label: string;
  /** `tel:` / `https:` open directly; omit for an in-app handler. */
  href?: string;
  onClick?: () => void;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  /** Exactly one action per row should be primary — the expected next step. */
  primary?: boolean;
}

export interface WorkQueueItem {
  id: string;
  title: string;
  subtitle: string;
  /** Large emphasised value, e.g. an amount or a bed count. */
  headline?: string;
  headlineTone?: 'default' | 'destructive' | 'success' | 'warning';
  /** Short urgency phrase beside the headline. */
  urgency?: string;
  /** Small supporting facts, joined with separators. */
  meta?: string[];
  /** Why this row sits where it does. Tapping opens `onExplain`. */
  reasons?: string[];
  actions: WorkQueueAction[];
  onOpen?: () => void;
}

export interface WorkQueueSection {
  id: string;
  label: string;
  /** Right-aligned summary, e.g. "4 · ₹34,000". */
  summary?: string;
  Icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  tone: string;
  items: WorkQueueItem[];
}

const HEADLINE_TONE: Record<string, string> = {
  default: 'text-foreground',
  destructive: 'text-destructive',
  success: 'text-success',
  warning: 'text-warning',
};

export function WorkQueueSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="rounded-2xl border border-border bg-card p-4">
          <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-3 w-1/3 animate-pulse rounded bg-muted" />
          <div className="mt-3 h-9 w-full animate-pulse rounded-lg bg-muted" />
        </div>
      ))}
    </div>
  );
}

function ActionButton({ action }: { action: WorkQueueAction }) {
  const { Icon } = action;
  const className = cn(
    'flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl text-[12px] font-bold transition-colors active:opacity-80',
    action.primary ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
  );

  if (action.href) {
    return (
      <a href={action.href} target={action.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className={className}>
        <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
        {action.label}
      </a>
    );
  }
  return (
    <button type="button" onClick={action.onClick} className={className}>
      <Icon className="h-3.5 w-3.5" strokeWidth={2.2} />
      {action.label}
    </button>
  );
}

function WorkQueueCard({
  item,
  position,
  onExplain,
}: {
  item: WorkQueueItem;
  position: number;
  onExplain?: (item: WorkQueueItem) => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04)]">
      <button type="button" onClick={item.onOpen} className="flex w-full items-start gap-3 p-4 text-left">
        {/* The number makes "work top to bottom" literal. */}
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-secondary font-display text-[12px] font-bold text-primary">
          {position}
        </span>

        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[15px] font-bold text-foreground">{item.title}</div>
          <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{item.subtitle}</div>

          {(item.headline || item.urgency) && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
              {item.headline && (
                <span
                  className={cn(
                    'font-display text-[15px] font-extrabold tabular-nums',
                    HEADLINE_TONE[item.headlineTone ?? 'default'],
                  )}
                >
                  {item.headline}
                </span>
              )}
              {item.urgency && <span className="text-[11px] font-semibold text-foreground/70">{item.urgency}</span>}
            </div>
          )}

          {item.meta && item.meta.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-x-2 text-[10.5px] text-muted-foreground">
              {item.meta.map((m, i) => (
                <span key={m}>
                  {i > 0 && <span aria-hidden="true" className="mr-2">·</span>}
                  {m}
                </span>
              ))}
            </div>
          )}
        </div>
      </button>

      {item.reasons && item.reasons.length > 0 && (
        <button
          type="button"
          onClick={() => onExplain?.(item)}
          className="flex w-full items-center gap-1.5 border-t border-border/60 px-4 py-2 text-left text-[10.5px] text-muted-foreground"
        >
          <Info className="h-3 w-3 flex-none" strokeWidth={2} />
          <span className="truncate">{item.reasons.join(' · ')}</span>
        </button>
      )}

      {item.actions.length > 0 && (
        <div className="flex items-stretch gap-1.5 border-t border-border/60 p-2">
          {item.actions.map((a) => (
            <ActionButton key={a.id} action={a} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Renders a whole queue screen. Sections arrive pre-ordered; rows within them
 * arrive pre-sorted. This component never reorders anything — ordering is a
 * business decision that belongs server-side.
 */
export function WorkQueue({
  title,
  subtitle,
  backTo = '/owner/home',
  state,
  sections,
  emptyTitle,
  emptyBody,
  onRetry,
  onExplain,
  children,
}: {
  title: string;
  subtitle?: string;
  backTo?: string;
  state: 'loading' | 'error' | 'empty' | 'ready';
  sections: WorkQueueSection[];
  emptyTitle: string;
  emptyBody: string;
  onRetry?: () => void;
  onExplain?: (item: WorkQueueItem) => void;
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  let position = 0;

  return (
    <div className="flex flex-col gap-4 px-4 pb-28 pt-5 sm:px-6">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate(backTo)}
          aria-label="Back"
          className="-ml-1 flex h-9 w-9 flex-none items-center justify-center rounded-full text-muted-foreground"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[19px] font-extrabold leading-tight text-foreground">{title}</h1>
          {state === 'ready' && subtitle && <p className="mt-0.5 text-[12px] text-muted-foreground">{subtitle}</p>}
        </div>
      </div>

      {state === 'loading' && <WorkQueueSkeleton />}

      {state === 'error' && (
        <div className="rounded-2xl border border-border bg-card p-6 text-center">
          <p className="text-[13px] font-semibold text-destructive">Could not load this list.</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded-xl bg-muted px-4 py-2 font-display text-[12.5px] font-bold text-foreground"
            >
              Try again
            </button>
          )}
        </div>
      )}

      {state === 'empty' && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card px-6 py-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/15">
            <Check className="h-7 w-7 text-success" strokeWidth={3} />
          </span>
          <p className="font-display text-[16px] font-extrabold text-foreground">{emptyTitle}</p>
          <p className="text-[12px] leading-relaxed text-muted-foreground">{emptyBody}</p>
        </div>
      )}

      {state === 'ready' &&
        sections.map((section) => {
          const { Icon } = section;
          return (
            <section key={section.id} className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2 pl-0.5">
                <Icon className={cn('h-4 w-4 flex-none', section.tone)} strokeWidth={2.2} />
                <h2 className="flex-1 font-display text-[13px] font-bold text-foreground">{section.label}</h2>
                {section.summary && (
                  <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">{section.summary}</span>
                )}
              </div>
              {section.items.map((item) => {
                position += 1;
                return <WorkQueueCard key={item.id} item={item} position={position} onExplain={onExplain} />;
              })}
            </section>
          );
        })}

      {children}
    </div>
  );
}
