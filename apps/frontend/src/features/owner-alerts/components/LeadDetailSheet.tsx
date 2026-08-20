import { useQuery } from '@tanstack/react-query';
import { Mail, Phone } from 'lucide-react';

import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { admissionsService } from '@features/admissions/api';
import { HostelStaySummary } from '@features/owner-tenants/components/HostelStaySummary';

const SOURCE_LABEL: Record<string, string> = {
  DISCOVER: 'website',
  QR: 'QR code',
  WALK_IN: 'walk-in',
};

interface LeadDetailSheetProps {
  leadId: string | null;
  onClose: () => void;
}

/**
 * Full detail for one enquiry/lead — reached from the Alerts "Leads" tab.
 * Per the explicit "never mix old and new" instruction: the previous-stay
 * summary (if any) renders in its own card, fully separate from the "New
 * Enquiry" section below it. Fetches via the existing, already-complete
 * `admissionsService.detail()` — no new backend route.
 */
export function LeadDetailSheet({ leadId, onClose }: LeadDetailSheetProps) {
  const { data: lead, isLoading } = useQuery({
    queryKey: ['owner', 'leads', leadId],
    queryFn: () => admissionsService.detail(leadId),
    enabled: Boolean(leadId),
  });

  return (
    <BottomSheet open={Boolean(leadId)} onOpenChange={(open) => !open && onClose()} title={lead?.student_name ?? 'Enquiry'}>
      {isLoading || !lead ? (
        <div className="flex flex-col gap-3 py-2">
          <div className="h-20 animate-pulse rounded-2xl bg-muted" />
          <div className="h-32 animate-pulse rounded-2xl bg-muted" />
        </div>
      ) : (
        <div className="flex flex-col gap-4 pb-4">
          <div className="flex flex-col gap-1.5 text-[12.5px] text-muted-foreground">
            {lead.student_phone && (
              <span className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5" strokeWidth={1.8} />
                {lead.student_phone}
              </span>
            )}
            {lead.student_email && (
              <span className="flex items-center gap-1.5">
                <Mail className="h-3.5 w-3.5" strokeWidth={1.8} />
                {lead.student_email}
              </span>
            )}
          </div>

          {lead.seeker_profile_id && <HostelStaySummary hostelId={lead.hostel_id} profileId={lead.seeker_profile_id} />}

          <section className="rounded-2xl border border-border bg-card p-4">
            <h3 className="mb-2 font-display text-[15px] font-bold text-foreground">New Enquiry</h3>
            <dl className="flex flex-col gap-2 text-[12.5px]">
              <Row label="Status" value={lead.status?.replace(/_/g, ' ')} />
              <Row label="Source" value={`Enquired via ${SOURCE_LABEL[lead.source] ?? lead.source} · ${lead.hostel?.name ?? ''}`} />
              <Row
                label="Received"
                value={
                  lead.first_visited_at
                    ? new Date(lead.first_visited_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                    : '—'
                }
              />
              {lead.notes && (
                <div className="pt-1">
                  <dt className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Message</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-foreground">{lead.notes}</dd>
                </div>
              )}
            </dl>
          </section>
        </div>
      )}
    </BottomSheet>
  );
}

function Row({ label, value }: { label: string; value: string | undefined | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-semibold text-foreground">{value}</dd>
    </div>
  );
}
