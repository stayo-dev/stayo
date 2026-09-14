/** The key under the building — what each kind of square means. */
export function BuildingLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 px-1 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-3 w-3 rounded-[4px] bg-gradient-to-br from-primary to-foreground" /> tenant
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-destructive" /> overdue
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="h-3 w-3 rounded-[4px] border-[1.5px] border-dashed border-warning/70 bg-warning-bg" /> invited
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden="true" className="flex h-3 w-3 items-center justify-center rounded-[4px] border-[1.5px] border-dashed border-border bg-muted text-[8px] font-bold">
          +
        </span>{' '}
        free bed
      </span>
    </div>
  );
}
