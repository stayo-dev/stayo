/**
 * The "N areas configured / N need attention" pair at the top of a module
 * screen. Both numbers come from `tallyConfigRows`, which excludes rows that
 * are switched off on purpose and rows whose subsystem does not exist yet — so
 * neither figure counts anything an owner cannot act on.
 *
 * The attention card is hidden entirely at zero rather than showing "0 need
 * attention", which reads like a warning at a glance.
 */
export function ConfigStatCards({
  configured,
  attention,
  isLoading = false,
}: {
  configured: number;
  attention: number;
  isLoading?: boolean;
}) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div className="h-[76px] animate-pulse rounded-[16px] bg-muted" />
        <div className="h-[76px] animate-pulse rounded-[16px] bg-muted" />
      </div>
    );
  }

  return (
    <div className={`grid gap-3 ${attention > 0 ? 'grid-cols-2' : 'grid-cols-1'}`}>
      <div className="rounded-[16px] bg-[color:var(--success)]/10 px-4 py-3.5">
        <div className="font-display text-[22px] font-extrabold leading-none text-[color:var(--success)]">
          {configured}
        </div>
        <div className="mt-1.5 text-[12px] text-[color:var(--success)]/80">areas configured</div>
      </div>
      {attention > 0 && (
        <div className="rounded-[16px] bg-[color:var(--warning)]/12 px-4 py-3.5">
          <div className="font-display text-[22px] font-extrabold leading-none text-[color:var(--warning)]">
            {attention}
          </div>
          <div className="mt-1.5 text-[12px] text-[color:var(--warning)]/85">need attention</div>
        </div>
      )}
    </div>
  );
}
