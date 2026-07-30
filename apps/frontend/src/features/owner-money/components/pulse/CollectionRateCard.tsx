interface CollectionRateCardProps {
  collectionRatePercent: number;
  due: string;
}

/** Collection-rate progress card, per Stayo App.dc.html. */
export function CollectionRateCard({ collectionRatePercent, due }: CollectionRateCardProps) {
  return (
    <div className="flex flex-col gap-2 rounded-[20px] border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <div className="flex justify-between text-xs font-medium text-muted-foreground">
        <span>Collection rate</span>
        <span className="font-bold tabular-nums text-foreground">{collectionRatePercent}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${collectionRatePercent}%` }} />
      </div>
      <p className="text-[11.5px] text-muted-foreground">
        {collectionRatePercent}% collected · {due} still expected this month
      </p>
    </div>
  );
}
