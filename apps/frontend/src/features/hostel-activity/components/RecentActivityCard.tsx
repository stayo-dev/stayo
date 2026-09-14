import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { queryKeys } from '@lib/queryKeys';
import { hostelActivityService, type ActivityEvent } from '../api';
import { actorLabel, categoryTone, groupActivityEvents, istTimeLabel } from '../groupActivityEvents';

const TONE_DOT: Record<string, string> = {
  success: 'bg-success',
  destructive: 'bg-destructive',
  warning: 'bg-warning',
  primary: 'bg-primary',
  muted: 'bg-muted-foreground/40',
};

const PREVIEW_LIMIT = 5;

function ActivityRow({ event }: { event: ActivityEvent }) {
  const tone = TONE_DOT[categoryTone(event.category)] ?? TONE_DOT.muted;
  const who = actorLabel(event.actor);
  const time = istTimeLabel(event.timestamp);

  return (
    <div className="flex items-start gap-2.5 py-2">
      <span className={`mt-1.5 h-1.5 w-1.5 flex-none rounded-full ${tone}`} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] text-foreground">{event.title}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {[who, time].filter(Boolean).join(' · ')}
        </p>
      </div>
    </div>
  );
}

/**
 * The Overview screen's window onto what has been happening in this hostel.
 *
 * Deliberately a preview, not a feed: five rows, no filters, no pagination,
 * and it asks the server for events only (`include=events`) so opening a
 * hostel never pays for the full timeline's balance reconstruction. Anything
 * more than a glance belongs on the history screen behind "See all".
 */
export function RecentActivityCard({ hostelId }: { hostelId: string }) {
  const navigate = useNavigate();

  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.activity.recent(hostelId, PREVIEW_LIMIT),
    queryFn: () => hostelActivityService.getRecent(hostelId, PREVIEW_LIMIT),
    enabled: Boolean(hostelId),
    staleTime: 60_000,
  });

  const groups = groupActivityEvents(data?.items ?? []);
  const hasEvents = groups.length > 0;

  // Nothing has happened here yet and nothing went wrong — an empty card
  // teaching an owner that the feature exists beats a card that vanishes.
  // A failed fetch is different: the feed is the one thing this card is for,
  // so it says so rather than implying a quiet hostel.
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <div className="flex items-center justify-between px-4 pb-1 pt-3.5">
        <h2 className="font-display text-[13.5px] font-bold text-foreground">Recent activity</h2>
        {hasEvents && (
          <button
            type="button"
            onClick={() => navigate(`/owner/hostels/${hostelId}/activity`)}
            className="-mr-2 inline-flex min-h-[36px] items-center gap-0.5 rounded-lg px-2 font-display text-xs font-bold text-primary"
          >
            See all
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.5} />
          </button>
        )}
      </div>

      <div className="px-4 pb-3">
        {isLoading && (
          <div className="space-y-2 py-2" aria-hidden>
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-8 animate-pulse rounded-lg bg-muted/60" />
            ))}
          </div>
        )}

        {!isLoading && isError && (
          <p className="py-3 text-xs text-muted-foreground">
            Couldn&apos;t load activity just now. Pull down to try again.
          </p>
        )}

        {!isLoading && !isError && !hasEvents && (
          <p className="py-3 text-xs text-muted-foreground">
            Nothing recorded here yet. Payments, expenses, check-ins and settings changes will
            appear as they happen.
          </p>
        )}

        {!isLoading &&
          !isError &&
          groups.map((group) => (
            <div key={group.key}>
              <div className="pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
                {group.label}
              </div>
              <div className="divide-y divide-border/60">
                {group.events.map((event) => (
                  <ActivityRow key={event.id} event={event} />
                ))}
              </div>
            </div>
          ))}
      </div>
    </section>
  );
}
