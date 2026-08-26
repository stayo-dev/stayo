import { useQuery } from '@tanstack/react-query';
import { Info } from 'lucide-react';
import api from '@lib/api-client';

/**
 * What leaving early costs, told to the tenant before they choose.
 *
 * The tenant is not shown their score anywhere else in the app — it exists for
 * owners deciding how to manage a tenancy. This is the single exception, and
 * only because a consequence someone cannot see is not one they can weigh.
 *
 * Deliberately not a warning, a confirmation step, or anything that makes
 * leaving harder. It states a fact, says the mark fades, and gets out of the
 * way. Someone moving out is usually doing so for a reason that outranks a
 * number, and the point is that they were told — not that they were deterred.
 */

interface ExitImpact {
  current: number | null;
  projected: number | null;
  drop: number;
  would_be_early: boolean;
  recovers_in_months: number;
}

export function ExitImpactNotice() {
  const { data } = useQuery({
    queryKey: ['tenant', 'exit-impact'],
    queryFn: async () => {
      const response = await api.get('/tenants/me/exit-impact');
      return (response.data?.data ?? response.data) as ExitImpact;
    },
    staleTime: 60_000,
    retry: false,
  });

  // Nothing to say when the stay has run its course, when there is no score
  // yet, or when the request failed. Silence beats a hedged non-statement.
  if (!data || !data.would_be_early || data.current == null || data.drop <= 0) return null;

  return (
    <div className="flex items-start gap-2.5 rounded-[14px] border border-border bg-muted/50 p-3.5">
      <Info className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" strokeWidth={1.9} />
      <div className="min-w-0">
        <p className="text-[12.5px] font-semibold leading-relaxed text-foreground">
          Leaving before your stay was due to end will lower your Stayo score from{' '}
          <b className="font-bold">{data.current}</b> to about{' '}
          <b className="font-bold">{data.projected}</b>.
        </p>
        <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
          It recovers over the next {data.recovers_in_months} months as you build history. This
          doesn't affect your deposit or anything you're owed — it's only what future hostels see
          about how your stays have gone.
        </p>
      </div>
    </div>
  );
}
