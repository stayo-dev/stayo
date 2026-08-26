import { Clock, ShieldCheck } from 'lucide-react';
import { StatusPill } from '@shared/ui-patterns/StatusPill';
import type { RealTenantDetail } from '../hooks/useTenantDetail';

/**
 * The tenant's payment-behaviour score, and what drives it.
 *
 * Previously this rendered `insights[0]` alone, so an owner saw one sentence
 * of the three or four the score service produces — "1 recent payment was
 * delayed" with no mention of how many reminders it took or the average delay,
 * which are the parts that distinguish a one-off from a pattern.
 *
 * `suggestions` is deliberately **not** shown. `tenantScoreService` backs both
 * `/api/tenants/:id/score` (owner) and `/api/tenants/me/score` (tenant), and
 * that array is written in the second person to the tenant — "Pay before due
 * date to steadily improve your score", "keep this streak going!". Rendered on
 * an owner's screen it reads as coaching the wrong person.
 */

/**
 * Written out rather than interpolated: Tailwind generates classes by scanning
 * source text, so `bg-${tone}/10` produces nothing at build time and the panel
 * would render unstyled.
 */
const TONE_STYLES = {
  success: { chip: 'bg-success/10', icon: 'text-success', panel: 'bg-success/10', text: 'text-success' },
  warning: { chip: 'bg-warning/10', icon: 'text-warning', panel: 'bg-warning/10', text: 'text-warning' },
  destructive: { chip: 'bg-destructive/10', icon: 'text-destructive', panel: 'bg-destructive/10', text: 'text-destructive' },
} as const;

export function RiskCard({ tenant }: { tenant: RealTenantDetail }) {
  const insights = tenant.riskInsights.length > 0 ? tenant.riskInsights : [tenant.riskInsight];
  const tone: keyof typeof TONE_STYLES =
    tenant.riskScore >= 70 ? 'success' : tenant.riskScore >= 40 ? 'warning' : 'destructive';
  const styles = TONE_STYLES[tone];

  return (
    <div className="flex flex-col gap-3 rounded-[18px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <div className="flex items-center gap-2.5">
        <span className={`flex h-9.5 w-9.5 flex-none items-center justify-center rounded-[11px] ${styles.chip}`}>
          <ShieldCheck className={`h-4.5 w-4.5 ${styles.icon}`} strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
            Risk &amp; Compliance
          </div>
          <div className="font-display text-lg font-extrabold tabular-nums text-foreground">
            {tenant.riskScore}
            <span className="text-[11px] font-semibold text-muted-foreground">/100</span>
          </div>
        </div>
        <StatusPill tone={tone} variant="filter">
          {tenant.riskLabel}
        </StatusPill>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <RiskTile label="Trend" value={tenant.riskTrend} />
        <RiskTile label="Agreement" value={tenant.agreementStatus} />
        <RiskTile label="KYC Verify" value={tenant.kycStatus} />
      </div>

      <ul className={`flex flex-col gap-1.5 rounded-xl p-3 ${styles.panel}`}>
        {insights.map((insight, i) => (
          <li key={i} className="flex items-start gap-2">
            <Clock className={`mt-0.5 h-3.5 w-3.5 flex-none ${styles.icon}`} strokeWidth={1.9} />
            <p className={`text-[12px] font-semibold leading-relaxed ${styles.text}`}>
              {insight}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RiskTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-xl bg-muted/50 p-2.5 text-center">
      <span className="font-display text-[11px] font-bold text-foreground">{label}</span>
      <span className="text-[10.5px] text-muted-foreground">{value}</span>
    </div>
  );
}
