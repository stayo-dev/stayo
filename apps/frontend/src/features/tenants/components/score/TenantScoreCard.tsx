import { TrendingUp, TrendingDown, Minus, ShieldCheck, ShieldAlert, Shield } from 'lucide-react';
import { StayoLoader } from '@shared/ui/brand';

const riskLabel: Record<string, string> = {
  EXCELLENT: 'Low Risk',
  GOOD: 'Low Risk',
  FAIR: 'Moderate',
  NEEDS_ATTENTION: 'Elevated',
  HIGH_RISK: 'High Risk',
};

const riskTone: Record<string, string> = {
  EXCELLENT: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  GOOD: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  FAIR: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  NEEDS_ATTENTION: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  HIGH_RISK: 'bg-rose-500/10 text-rose-600 border-rose-500/20',
};

const riskIcon: Record<string, typeof ShieldCheck> = {
  EXCELLENT: ShieldCheck,
  GOOD: ShieldCheck,
  FAIR: Shield,
  NEEDS_ATTENTION: ShieldAlert,
  HIGH_RISK: ShieldAlert,
};

const trendMeta: Record<string, { label: string; icon: typeof TrendingUp; cls: string }> = {
  IMPROVING: { label: 'Improving', icon: TrendingUp, cls: 'text-emerald-600' },
  STABLE: { label: 'Stable', icon: Minus, cls: 'text-muted-foreground' },
  DECLINING: { label: 'Declining', icon: TrendingDown, cls: 'text-rose-500' },
};

function ownerInsight(grade: string, insights: string[]): string {
  const lateMatch = insights.find((i) => /\d+.*payment.*delayed/i.test(i));
  const delayMatch = insights.find((i) => /average delay/i.test(i));

  if (grade === 'EXCELLENT' || grade === 'GOOD') {
    return 'Reliable payer — no action needed';
  }
  if (grade === 'FAIR') {
    const parts: string[] = [];
    if (lateMatch) parts.push(lateMatch.replace(/\.$/, ''));
    if (delayMatch) parts.push(delayMatch.replace(/\.$/, '').toLowerCase());
    return parts.length > 0 ? parts.join('. ') + '.' : 'Occasional delays — monitor closely';
  }
  if (grade === 'NEEDS_ATTENTION' || grade === 'HIGH_RISK') {
    const parts: string[] = [];
    if (lateMatch) parts.push(lateMatch.replace(/\.$/, ''));
    if (delayMatch) parts.push(delayMatch.replace(/\.$/, '').toLowerCase());
    return parts.length > 0
      ? parts.join('. ') + '. Consider follow-up.'
      : 'Frequent payment issues — follow-up recommended';
  }
  return 'No assessment available';
}

function ownerAction(grade: string): string | null {
  switch (grade) {
    case 'HIGH_RISK':
      return 'Send payment reminder or schedule a call';
    case 'NEEDS_ATTENTION':
      return 'Send a gentle reminder before next due date';
    case 'FAIR':
      return 'Keep monitoring — no immediate action required';
    default:
      return null;
  }
}

interface ScoreData {
  score: number;
  grade: string;
  trend: string;
  status?: string;
  insights?: string[];
  suggestions?: string[];
}

interface Props {
  scoreData?: ScoreData | null;
  loading?: boolean;
}

export function TenantScoreCard({ scoreData, loading = false }: Props) {
  if (loading) {
    return (
      <div className="p-4 rounded-xl border border-border bg-card shadow-sm flex items-center justify-center h-24">
        <StayoLoader size="md" className="text-accent" />
      </div>
    );
  }

  if (!scoreData) return null;

  const grade = scoreData.grade || 'GOOD';
  const trend = scoreData.trend || 'STABLE';
  const trendInfo = trendMeta[trend] || trendMeta.STABLE;
  const TrendIcon = trendInfo.icon;
  const RiskIcon = riskIcon[grade] || Shield;
  const insight = ownerInsight(grade, scoreData.insights ?? []);
  const action = ownerAction(grade);

  return (
    <div className="p-4 rounded-xl border border-border bg-card shadow-sm space-y-3">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
            grade === 'HIGH_RISK' || grade === 'NEEDS_ATTENTION'
              ? 'bg-rose-500/10'
              : grade === 'FAIR'
              ? 'bg-amber-500/10'
              : 'bg-emerald-500/10'
          }`}>
            <RiskIcon size={16} className={
              grade === 'HIGH_RISK' || grade === 'NEEDS_ATTENTION'
                ? 'text-rose-500'
                : grade === 'FAIR'
                ? 'text-amber-500'
                : 'text-emerald-500'
            } />
          </div>
          <div>
            <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Payment Reliability</p>
            <p className="text-lg font-black text-foreground leading-tight">{scoreData.score}<span className="text-sm font-medium text-muted-foreground">/100</span></p>
          </div>
        </div>
        <div className="text-right flex flex-col items-end gap-1.5">
          <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold border ${riskTone[grade] || riskTone.GOOD}`}>
            {riskLabel[grade] || 'Low Risk'}
          </span>
          <span className={`flex items-center gap-1 text-[11px] font-semibold ${trendInfo.cls}`}>
            <TrendIcon size={12} />
            {trendInfo.label}
          </span>
        </div>
      </div>

      {/* Owner-oriented assessment */}
      <p className="text-xs text-muted-foreground leading-relaxed">{insight}</p>

      {/* Action recommendation for non-good tenants */}
      {action && (
        <div className={`text-[11px] font-medium px-3 py-2 rounded-lg border ${
          grade === 'HIGH_RISK'
            ? 'border-rose-200 bg-rose-50 text-rose-700'
            : grade === 'NEEDS_ATTENTION'
            ? 'border-orange-200 bg-orange-50 text-orange-700'
            : 'border-amber-200 bg-amber-50 text-amber-700'
        }`}>
          💡 {action}
        </div>
      )}
    </div>
  );
}
