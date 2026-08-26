import { useQuery } from '@tanstack/react-query';
import { MessageSquareWarning } from 'lucide-react';
import { StatusPill } from '@shared/ui-patterns/StatusPill';
import { ownerServiceRequestsService } from '@features/hostel-content/api/serviceRequests';

/**
 * What this tenant has raised.
 *
 * The owner could previously only see complaints hostel-wide, at
 * `/owner/more/service-requests` — there was no way to ask "what has *this*
 * person reported?" while looking at their profile, which is exactly when the
 * question comes up.
 *
 * `GET /api/service-requests` filters by `hostelId` and `status` only, with no
 * tenant parameter, so the narrowing happens here. That means fetching the
 * hostel's requests to show one tenant's — acceptable at the scale a single
 * hostel operates at, and it reuses a query the owner app already caches
 * rather than adding an endpoint. Worth a server-side filter if a hostel ever
 * carries enough requests for this to be felt.
 */

const STATUS_TONE: Record<string, 'success' | 'warning' | 'destructive' | 'neutral'> = {
  RESOLVED: 'success',
  CLOSED: 'success',
  IN_PROGRESS: 'warning',
  OPEN: 'destructive',
  PENDING: 'destructive',
};

function formatDate(value: string): string {
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function titleCase(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase());
}

export function TenantRequestsCard({ hostelId, tenantId }: { hostelId: string; tenantId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['owner', 'service-requests', hostelId],
    queryFn: () => ownerServiceRequestsService.list(hostelId),
    enabled: Boolean(hostelId),
    staleTime: 60_000,
    retry: false,
  });

  const mine = (data ?? []).filter((request) => request.tenants?.id === tenantId);

  // Additive section: a tenant who has raised nothing adds no empty card.
  if (isLoading || mine.length === 0) return null;

  const open = mine.filter((r) => !['RESOLVED', 'CLOSED'].includes(String(r.status).toUpperCase()));

  return (
    <section className="flex flex-col gap-2.5 rounded-[18px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <div className="flex items-center gap-2">
        <MessageSquareWarning className="h-4 w-4 text-primary" strokeWidth={1.8} />
        <span className="font-display text-[15px] font-bold text-foreground">Raised by this tenant</span>
        {open.length > 0 && (
          <span className="ml-auto text-[11.5px] font-semibold text-warning">{open.length} open</span>
        )}
      </div>

      <ul className="flex flex-col gap-2">
        {mine.slice(0, 5).map((request) => (
          <li key={request.id} className="flex items-start gap-2.5 rounded-xl bg-muted/50 p-3">
            <div className="min-w-0 flex-1">
              <div className="text-[12.5px] font-bold leading-tight text-foreground">
                {titleCase(request.category || request.type || 'Request')}
              </div>
              {request.description && (
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                  {request.description}
                </p>
              )}
              <div className="mt-1 text-[10.5px] text-muted-foreground">{formatDate(request.created_at)}</div>
            </div>
            <StatusPill tone={STATUS_TONE[String(request.status).toUpperCase()] ?? 'neutral'}>
              {titleCase(String(request.status))}
            </StatusPill>
          </li>
        ))}
      </ul>

      {mine.length > 5 && (
        <p className="text-[11px] text-muted-foreground">
          Showing the 5 most recent of {mine.length}.
        </p>
      )}
    </section>
  );
}
