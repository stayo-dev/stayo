import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Search, X } from 'lucide-react';
import { queryKeys } from '@lib/queryKeys';
import { hostelActivityService, type ActivityEvent, type ActivityFeedPage } from '../api';
import {
  ACTIVITY_CATEGORIES,
  actorLabel,
  categoryTone,
  groupActivityEvents,
  istTimeLabel,
} from '../groupActivityEvents';

const TONE_DOT: Record<string, string> = {
  success: 'bg-success',
  destructive: 'bg-destructive',
  warning: 'bg-warning',
  primary: 'bg-primary',
  muted: 'bg-muted-foreground/40',
};

/**
 * Paged rather than a growing `limit`: the route clamps `limit` to 100, so a
 * button that kept raising it would silently stop working at that ceiling —
 * the same trap the admissions feed documents.
 */
const PAGE_SIZE = 25;

function EventRow({ event }: { event: ActivityEvent }) {
  const tone = TONE_DOT[categoryTone(event.category)] ?? TONE_DOT.muted;

  return (
    <div className="flex items-start gap-3 py-3">
      <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${tone}`} />
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] text-foreground">{event.title}</p>
        {event.subtitle && (
          <p className="mt-0.5 text-[12px] text-muted-foreground">{event.subtitle}</p>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          {[actorLabel(event.actor), istTimeLabel(event.timestamp), event.category]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
    </div>
  );
}

/**
 * Hostel Drill-down → Activity sub-tab: the full per-hostel history behind the
 * Overview card's "See all".
 *
 * A tab rather than a standalone takeover, because the drilldown is a
 * master-detail pane inside the owner console at `lg+` — a route declared
 * outside it would render the history without the console sidebar, and would
 * need its own entry in `isOwnerFullBleedPath` to avoid the bottom nav below
 * `lg`. As a tab it inherits both for free, and the tab row already scrolls.
 *
 * Renders no chrome of its own: `HostelDrilldownLayout` supplies the surface,
 * the back button, the hostel name and the tab row.
 *
 * Note what this feed can and cannot tell you: payments, expenses, check-ins,
 * move-outs, invitations and documents are read back from the live records, so
 * an action whose record was later deleted leaves no trace. Only settings
 * changes, rent runs, room changes and expense edits/deletions come from a
 * true write-time log.
 */
export function HostelActivityPage() {
  const { hostelId } = useParams<{ hostelId: string }>();
  const [category, setCategory] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const feedQuery = useInfiniteQuery({
    queryKey: queryKeys.activity.feed(hostelId ?? '', { category, search }),
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      hostelActivityService.getFeed(hostelId!, {
        limit: PAGE_SIZE,
        offset: pageParam as number,
        ...(category ? { category } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
      }),
    getNextPageParam: (last: ActivityFeedPage, pages) => {
      const loaded = pages.reduce((n, p) => n + (p.items?.length ?? 0), 0);
      return loaded < (last.total ?? 0) ? loaded : undefined;
    },
    enabled: Boolean(hostelId),
    staleTime: 30_000,
  });

  if (!hostelId) return null;

  const pages = feedQuery.data?.pages ?? [];
  const events = pages.flatMap((p) => p.items ?? []);
  const total = pages[0]?.total ?? 0;
  const groups = groupActivityEvents(events);

  return (
    <div className="flex flex-col gap-3">
      <label className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2">
        <Search className="h-4 w-4 flex-none text-muted-foreground" strokeWidth={2} />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search this hostel's activity"
          className="min-w-0 flex-1 bg-transparent text-[13px] text-foreground outline-none placeholder:text-muted-foreground"
        />
        {search && (
          <button
            type="button"
            onClick={() => setSearch('')}
            aria-label="Clear search"
            className="flex-none text-muted-foreground"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        )}
      </label>

      {/* Scrolls, like the drilldown's own tab row — nine chips will not fit
          across a 360px phone, and a row that overflows invisibly is how the
          tenant nav lost a tab. */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:-mx-6 sm:px-6 [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => setCategory(null)}
          className={`flex-none whitespace-nowrap rounded-full border px-3 py-1.5 font-display text-[12px] font-bold ${
            category === null
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border bg-card text-muted-foreground'
          }`}
        >
          All
        </button>
        {ACTIVITY_CATEGORIES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCategory(category === c ? null : c)}
            className={`flex-none whitespace-nowrap rounded-full border px-3 py-1.5 font-display text-[12px] font-bold ${
              category === c
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border bg-card text-muted-foreground'
            }`}
          >
            {c}
          </button>
        ))}
      </div>

      {!feedQuery.isLoading && !feedQuery.isError && total > 0 && (
        <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {total} {total === 1 ? 'event' : 'events'}
        </p>
      )}

      {feedQuery.isLoading && (
        <div className="space-y-2" aria-hidden>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-xl bg-muted/60" />
          ))}
        </div>
      )}

      {!feedQuery.isLoading && feedQuery.isError && (
        <p className="text-[13px] text-muted-foreground">
          Couldn&apos;t load this hostel&apos;s activity.{' '}
          <button
            type="button"
            onClick={() => feedQuery.refetch()}
            className="font-display font-bold text-primary"
          >
            Try again
          </button>
        </p>
      )}

      {!feedQuery.isLoading && !feedQuery.isError && groups.length === 0 && (
        <p className="text-[13px] text-muted-foreground">
          {category || search.trim()
            ? 'Nothing matches that filter.'
            : 'Nothing has been recorded for this hostel yet.'}
        </p>
      )}

      {groups.map((group) => (
        <div key={group.key}>
          <div className="pb-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {group.label}
          </div>
          <div className="divide-y divide-border/60 rounded-2xl border border-border bg-card px-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
            {group.events.map((event) => (
              <EventRow key={event.id} event={event} />
            ))}
          </div>
        </div>
      ))}

      {feedQuery.hasNextPage && (
        <button
          type="button"
          onClick={() => feedQuery.fetchNextPage()}
          disabled={feedQuery.isFetchingNextPage}
          className="mt-1 min-h-[44px] w-full rounded-xl border-[1.5px] border-primary font-display text-[13px] font-bold text-primary disabled:opacity-60"
        >
          {feedQuery.isFetchingNextPage ? 'Loading…' : 'Show older'}
        </button>
      )}
    </div>
  );
}
