import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  AlertTriangle,
  Clock,
  Hourglass,
  CalendarDays,
  Phone,
  MessageCircle,
  Wallet,
  Info,
  Check,
} from 'lucide-react';
import { cn } from '@shared/lib/cn';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { QuickCollectModal } from '@features/owner-tenants/quick-collect/QuickCollectModal';
import { getInitials } from '@features/tenants/utils/normalize';
import { useCollectionQueue } from './useCollectionQueue';
import {
  formatINR,
  urgencyLabel,
  locationLabel,
  lastPaymentLabel,
  lastReminderLabel,
  topReasons,
  whatsAppNumber,
  phoneDigits,
  type CollectionQueueRow,
  type BucketId,
} from './collectionQueue';
import type { QuickCollectTenant } from '@features/owner-tenants/types';

/** Icons, not emoji. Tone drives the section accent. */
const BUCKET_STYLE: Record<string, { Icon: typeof AlertTriangle; tone: string; accent: string }> = {
  NEEDS_ATTENTION: { Icon: AlertTriangle, tone: 'text-destructive', accent: 'bg-destructive' },
  DUE_TODAY: { Icon: Clock, tone: 'text-warning', accent: 'bg-warning' },
  AWAITING_REMINDER: { Icon: Hourglass, tone: 'text-info', accent: 'bg-info' },
  DUE_SOON: { Icon: CalendarDays, tone: 'text-muted-foreground', accent: 'bg-muted-foreground' },
};

function QueueSkeleton() {
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

function QueueCard({
  row,
  position,
  onCollect,
  onWhy,
}: {
  row: CollectionQueueRow;
  position: number;
  onCollect: (row: CollectionQueueRow) => void;
  onWhy: (row: CollectionQueueRow) => void;
}) {
  const navigate = useNavigate();
  const digits = phoneDigits(row.phone);
  const wa = whatsAppNumber(row.phone);
  const reasons = topReasons(row);

  const actionClass =
    'flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl text-[12px] font-bold transition-colors active:opacity-80';

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04)]">
      <button
        type="button"
        onClick={() => navigate(`/owner/tenants/${row.tenantId}`)}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        {/* Position makes "work top to bottom" literal. */}
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-secondary font-display text-[12px] font-bold text-primary">
          {position}
        </span>

        <div className="min-w-0 flex-1">
          <div className="truncate font-display text-[15px] font-bold text-foreground">{row.tenantName}</div>
          <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground">{locationLabel(row)}</div>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
            <span className="font-display text-[15px] font-extrabold tabular-nums text-destructive">
              {formatINR(row.outstanding)}
            </span>
            <span className="font-semibold text-foreground/70">{urgencyLabel(row)}</span>
          </div>

          <div className="mt-1 flex flex-wrap gap-x-2 text-[10.5px] text-muted-foreground">
            <span>{lastPaymentLabel(row)}</span>
            <span aria-hidden="true">·</span>
            <span>{lastReminderLabel(row)}</span>
          </div>
        </div>
      </button>

      {reasons.length > 0 && (
        <button
          type="button"
          onClick={() => onWhy(row)}
          className="flex w-full items-center gap-1.5 border-t border-border/60 px-4 py-2 text-left text-[10.5px] text-muted-foreground"
        >
          <Info className="h-3 w-3 flex-none" strokeWidth={2} />
          <span className="truncate">{reasons.join(' · ')}</span>
        </button>
      )}

      <div className="flex items-stretch gap-1.5 border-t border-border/60 p-2">
        <button type="button" onClick={() => onCollect(row)} className={cn(actionClass, 'bg-primary text-primary-foreground')}>
          <Wallet className="h-3.5 w-3.5" strokeWidth={2.2} />
          Collect
        </button>
        {digits && (
          <a href={`tel:+${wa ?? digits}`} className={cn(actionClass, 'bg-muted text-foreground')}>
            <Phone className="h-3.5 w-3.5" strokeWidth={2.2} />
            Call
          </a>
        )}
        {wa && (
          <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className={cn(actionClass, 'bg-muted text-foreground')}>
            <MessageCircle className="h-3.5 w-3.5" strokeWidth={2.2} />
            WhatsApp
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Today's Collection Queue (ADR-045, Phase 2).
 *
 * Not a filtered tenant list — a work queue. Sections are ordered by urgency
 * and rows within them by an explainable priority score, so the owner works
 * top to bottom and never has to decide who is next.
 *
 * Cards, not a table; every action is a thumb-sized target; the "why" opens in
 * a bottom sheet rather than a new page.
 */
export function CollectionQueuePage() {
  const navigate = useNavigate();
  const { groups, totalTenants, totalOutstanding, state, refetch } = useCollectionQueue();
  const [why, setWhy] = useState<CollectionQueueRow | null>(null);
  const [collectFor, setCollectFor] = useState<QuickCollectTenant | undefined>(undefined);

  const openCollect = (row: CollectionQueueRow) => {
    setCollectFor({
      id: row.tenantId,
      name: row.tenantName,
      initials: getInitials(row.tenantName),
      phone: row.phone,
      hostelId: row.hostelId,
      hostelName: row.hostelName,
      room: row.room || 'N/A',
      outstanding: row.outstanding,
      deposit: 0,
    });
  };

  let position = 0;

  return (
    <div className="flex flex-col gap-4 px-4 pb-28 pt-5 sm:px-6">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate('/owner/home')}
          aria-label="Back to home"
          className="-ml-1 flex h-9 w-9 flex-none items-center justify-center rounded-full text-muted-foreground"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2} />
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[19px] font-extrabold leading-tight text-foreground">Today's collection</h1>
          {state === 'ready' && (
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {totalTenants} tenant{totalTenants === 1 ? '' : 's'} · {formatINR(totalOutstanding)} to collect
            </p>
          )}
        </div>
      </div>

      {state === 'loading' && <QueueSkeleton />}

      {state === 'error' && (
        <div className="rounded-2xl border border-border bg-card p-6 text-center">
          <p className="text-[13px] font-semibold text-destructive">Could not load today's queue.</p>
          <button
            type="button"
            onClick={() => refetch()}
            className="mt-3 rounded-xl bg-muted px-4 py-2 font-display text-[12.5px] font-bold text-foreground"
          >
            Try again
          </button>
        </div>
      )}

      {state === 'all-clear' && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-border bg-card px-6 py-12 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-success/15">
            <Check className="h-7 w-7 text-success" strokeWidth={3} />
          </span>
          <p className="font-display text-[16px] font-extrabold text-foreground">Nothing to collect today</p>
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            No rent is overdue or due in the next week.
          </p>
        </div>
      )}

      {state === 'ready' &&
        groups.map((group) => {
          const style = BUCKET_STYLE[group.id as BucketId] ?? BUCKET_STYLE.DUE_SOON;
          const { Icon } = style;
          return (
            <section key={group.id} className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2 pl-0.5">
                <Icon className={cn('h-4 w-4 flex-none', style.tone)} strokeWidth={2.2} />
                <h2 className="flex-1 font-display text-[13px] font-bold text-foreground">{group.label}</h2>
                <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
                  {group.count} · {formatINR(group.totalOutstanding)}
                </span>
              </div>
              {group.rows.map((row) => {
                position += 1;
                return (
                  <QueueCard key={row.tenantId} row={row} position={position} onCollect={openCollect} onWhy={setWhy} />
                );
              })}
            </section>
          );
        })}

      {/* The full "why", on demand. Ordering is never a black box. */}
      <BottomSheet open={why != null} onOpenChange={(v) => !v && setWhy(null)} title={why ? `Why ${why.tenantName} is here` : ''}>
        {why && (
          <div className="flex flex-col gap-2">
            {why.factors.length === 0 && (
              <p className="text-[12.5px] text-muted-foreground">No priority signals — this tenant simply owes money.</p>
            )}
            {[...why.factors]
              .sort((a, b) => b.points - a.points)
              .map((f) => (
                <div key={f.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3.5 py-2.5">
                  <span className="text-[12.5px] text-foreground">{f.label}</span>
                  <span className="flex-none font-display text-[12px] font-bold tabular-nums text-muted-foreground">
                    +{f.points}
                  </span>
                </div>
              ))}
            <div className="mt-1 flex items-center justify-between gap-3 px-3.5">
              <span className="text-[12.5px] font-bold text-foreground">Priority score</span>
              <span className="font-display text-[13px] font-extrabold tabular-nums text-foreground">{why.score}</span>
            </div>
            <p className="mt-1 px-0.5 text-[11px] leading-relaxed text-muted-foreground">
              Higher scores are shown first within each section. Sections themselves are ordered by urgency.
            </p>
          </div>
        )}
      </BottomSheet>

      <QuickCollectModal
        open={collectFor != null}
        onClose={() => setCollectFor(undefined)}
        initialTenant={collectFor}
      />
    </div>
  );
}
