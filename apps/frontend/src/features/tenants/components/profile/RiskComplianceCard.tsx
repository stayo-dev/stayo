import { ShieldCheck, ShieldAlert, FileCheck2, UserCheck, AlertTriangle, TrendingDown, TrendingUp, AlertCircle, CheckCircle2, Info, Sparkles } from 'lucide-react';
import { StayoLoader } from '@shared/ui/brand';

interface RiskComplianceCardProps {
  score?: number | null;
  hasAgreement: boolean;
  documentStatus: string;
  overdueDays: number;
  depositStatus: string;
  loading?: boolean;
}

interface Insight {
  type: 'critical' | 'warning' | 'success' | 'info';
  message: string;
  icon: typeof TrendingDown;
}

function insightColors(type: Insight['type']): string {
  switch (type) {
    case 'critical':
      return 'bg-rose-500/10 text-rose-600 border-rose-500/25 dark:bg-rose-950/20 dark:text-rose-400';
    case 'warning':
      return 'bg-amber-500/10 text-amber-600 border-amber-500/25 dark:bg-amber-950/20 dark:text-amber-400';
    case 'success':
      return 'bg-emerald-500/10 text-emerald-600 border-emerald-500/25 dark:bg-emerald-950/20 dark:text-emerald-400';
    default:
      return 'bg-blue-500/10 text-blue-600 border-blue-500/25 dark:bg-blue-950/20 dark:text-blue-400';
  }
}

/**
 * Replaces the former TenantHealthCard + OwnerInsights pair, which
 * independently derived and displayed the same agreement/KYC/score signals —
 * one as a composite score + checklist, the other as prose warnings restating
 * the same checklist items. The checklist below is the single source of
 * truth for Agreement/KYC status; narrative insights here are only the ones
 * that add information the checklist doesn't already state (score-derived
 * risk, overdue alert, deposit status) — agreement-missing and KYC-missing
 * insights are deliberately NOT repeated here.
 */
export function RiskComplianceCard({
  score,
  hasAgreement,
  documentStatus,
  overdueDays,
  depositStatus,
  loading = false,
}: RiskComplianceCardProps) {
  if (loading) {
    return (
      <div className="p-4 rounded-2xl border border-border bg-card shadow-sm flex items-center justify-center h-24">
        <StayoLoader size="md" className="text-accent" />
      </div>
    );
  }

  const baseScore = score ?? 75;
  let compositeScore = baseScore;
  if (!hasAgreement) compositeScore -= 15;
  if (documentStatus === 'MISSING') compositeScore -= 15;
  else if (documentStatus === 'PENDING') compositeScore -= 5;
  compositeScore = Math.max(10, Math.min(100, compositeScore));

  let healthLevel: 'Excellent' | 'Good' | 'Risk' | 'Critical' = 'Good';
  let healthBg = 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:bg-emerald-950/20 dark:text-emerald-400';
  let healthText = 'Payer reliability is high, all core configurations verified.';

  if (compositeScore >= 90) {
    healthLevel = 'Excellent';
  } else if (compositeScore >= 70) {
    healthLevel = 'Good';
    healthBg = 'bg-blue-500/10 text-blue-600 border-blue-500/20 dark:bg-blue-950/20 dark:text-blue-400';
    healthText = 'Minor document or verification checklist pending.';
  } else if (compositeScore >= 45) {
    healthLevel = 'Risk';
    healthBg = 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:bg-amber-950/20 dark:text-amber-400';
    healthText = 'Elevated default or non-compliance risk. Active follow-up needed.';
  } else {
    healthLevel = 'Critical';
    healthBg = 'bg-rose-500/10 text-rose-600 border-rose-500/20 dark:bg-rose-950/20 dark:text-rose-400';
    healthText = 'Critical status. Highly delayed payments or major agreement issues.';
  }

  const insights: Insight[] = [];

  if (score !== undefined && score !== null) {
    if (score < 60) {
      insights.push({ type: 'critical', message: 'High risk of payment default. Prioritize immediate collection.', icon: TrendingDown });
    } else if (score >= 85) {
      insights.push({ type: 'success', message: 'Excellent payment reliability. Standard auto-reminders are sufficient.', icon: TrendingUp });
    } else if (score < 75) {
      insights.push({ type: 'warning', message: 'Moderate risk. Often pays only after repeated WhatsApp reminders.', icon: Info });
    }
  }

  if (overdueDays > 15) {
    insights.push({ type: 'critical', message: `Tenant is ${overdueDays} days overdue. Contact guardian if tenant does not respond.`, icon: AlertCircle });
  }

  if (depositStatus === 'PENDING') {
    insights.push({ type: 'warning', message: 'Refundable security deposit is unpaid. Restrict room movement.', icon: AlertCircle });
  } else if (depositStatus === 'WAIVED') {
    insights.push({ type: 'info', message: 'Security deposit waived by owner. (₹0 deposit arrangement active).', icon: CheckCircle2 });
  }

  if (insights.length === 0) {
    insights.push({ type: 'info', message: 'All billing configurations and verification details are in order.', icon: CheckCircle2 });
  }

  return (
    <div className="p-4 rounded-2xl border border-border bg-card shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${healthBg}`}>
            {healthLevel === 'Excellent' || healthLevel === 'Good' ? <ShieldCheck className="w-5 h-5" /> : <ShieldAlert className="w-5 h-5" />}
          </div>
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Risk &amp; Compliance</p>
            <p className="text-lg font-black text-foreground leading-tight">
              {compositeScore}
              <span className="text-xs font-semibold text-muted-foreground">/100</span>
            </p>
          </div>
        </div>
        <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${healthBg}`}>{healthLevel}</span>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{healthText}</p>

      <div className="grid grid-cols-3 gap-2.5 pt-2.5 border-t border-border/60 text-[10px]">
        <div className="flex flex-col gap-1 items-center justify-center p-2 rounded-xl bg-secondary/50 border border-border/50 text-center">
          <UserCheck className="w-4 h-4 text-muted-foreground" />
          <span className="font-semibold text-foreground">Payment Rate</span>
          <span className="text-muted-foreground font-medium">{baseScore}%</span>
        </div>
        <div className="flex flex-col gap-1 items-center justify-center p-2 rounded-xl bg-secondary/50 border border-border/50 text-center">
          <FileCheck2 className={`w-4 h-4 ${hasAgreement ? 'text-emerald-500' : 'text-rose-500'}`} />
          <span className="font-semibold text-foreground">Agreement</span>
          <span className="text-muted-foreground font-medium">{hasAgreement ? 'Signed' : 'Missing'}</span>
        </div>
        <div className="flex flex-col gap-1 items-center justify-center p-2 rounded-xl bg-secondary/50 border border-border/50 text-center">
          <AlertTriangle className={`w-4 h-4 ${documentStatus === 'VERIFIED' ? 'text-emerald-500' : 'text-amber-500'}`} />
          <span className="font-semibold text-foreground">KYC Verification</span>
          <span className="text-muted-foreground font-medium">
            {documentStatus === 'VERIFIED' ? 'Verified' : documentStatus === 'PENDING' ? 'Pending' : 'Missing'}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-2 pt-1">
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5 text-accent" />
          <span>Insights</span>
        </div>
        {insights.map((insight, idx) => {
          const Icon = insight.icon;
          return (
            <div key={idx} className={`flex items-start gap-2.5 p-3 rounded-xl border text-xs leading-relaxed font-medium ${insightColors(insight.type)}`}>
              <Icon className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{insight.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
