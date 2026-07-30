import { Sparkles } from 'lucide-react';
import { SMART_INSIGHTS } from '@shared/mocks/food';

/** Static Smart Insights rows shown under the Food Polls list. */
export function SmartInsightsList() {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Smart Insights</span>
      </div>
      <div className="flex flex-col gap-2">
        {SMART_INSIGHTS.map((insight, i) => (
          <div key={i} className="flex items-center gap-2.5 rounded-2xl border border-border bg-muted/40 px-3.5 py-3">
            <span className="text-base">{insight.icon}</span>
            <span className="text-[12.5px] leading-snug text-foreground/85">{insight.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
