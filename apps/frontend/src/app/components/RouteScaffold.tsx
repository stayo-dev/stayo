/**
 * Temporary placeholder rendered by routes that don't have a real StayO
 * screen built yet. Foundation-only pass: routing/layout/theming is wired
 * and verifiable end-to-end without any feature-page UI existing. Remove
 * each usage as the real screen for that route lands — see
 * docs/migration/frontend-foundation-tracker.md.
 */
export function RouteScaffold({ label }: { label: string }) {
  return (
    <div className="flex min-h-[50vh] items-center justify-center p-6">
      <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-8 text-center">
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Not built yet
        </p>
        <p className="mt-2 text-lg font-bold text-foreground">{label}</p>
      </div>
    </div>
  );
}
