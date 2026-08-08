import type { ConfigWorkflowRow as WorkflowRow } from '../config/deriveAutomationSections';

/**
 * A bare switch. `owner-food`'s `Toggle` is a full-width labelled row with its
 * own border and a hardcoded `#A45D44` (the marketing primary, wrong under the
 * product theme these screens render in), so reusing it here would duplicate
 * the layout and the colour mistake.
 */
function ConfigSwitch({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative h-[25px] w-[42px] flex-none rounded-full transition-colors ${
        checked ? 'bg-primary' : 'bg-muted'
      }`}
    >
      <span
        className={`absolute top-0.5 h-[21px] w-[21px] rounded-full bg-white shadow transition-transform ${
          checked ? 'translate-x-[17px]' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}

/**
 * An automation row: status dot, title, Active/Paused pill, sub-line, and a
 * live toggle.
 *
 * Every toggle here gates a real cron job, so the row shows a pending state
 * while the PATCH is in flight rather than flipping optimistically — an owner
 * should not see "Active" for a workflow whose write failed.
 *
 * An `unavailable` row renders no toggle at all. `buildWorkflowPatch` also
 * refuses those, so there are two independent guards against writing one.
 */
export function ConfigWorkflowRow({
  row,
  onToggle,
  isPending = false,
  className = '',
}: {
  row: WorkflowRow;
  onToggle: (row: WorkflowRow, next: boolean) => void;
  isPending?: boolean;
  className?: string;
}) {
  const unavailable = row.enabled === null;

  return (
    <div className={`flex items-start gap-3 px-4 py-3.5 ${unavailable ? 'opacity-60' : ''} ${className}`}>
      <span
        aria-hidden="true"
        className={`mt-[7px] h-[7px] w-[7px] flex-none rounded-full ${
          row.enabled === true
            ? 'bg-[color:var(--success)]'
            : unavailable
              ? 'bg-muted-foreground/25'
              : 'bg-muted-foreground/40'
        }`}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className={`text-[14px] font-semibold ${unavailable ? 'text-muted-foreground' : 'text-foreground'}`}
          >
            {row.title}
          </span>
          {row.enabled !== null && (
            <span
              className={`text-[10.5px] font-semibold uppercase tracking-wide ${
                row.enabled ? 'text-[color:var(--success)]' : 'text-muted-foreground'
              }`}
            >
              {row.enabled ? 'Active' : 'Paused'}
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[12px] text-muted-foreground">{row.detail}</div>
      </div>

      {row.enabled !== null && (
        <div className={`mt-0.5 flex-none ${isPending ? 'pointer-events-none opacity-50' : ''}`}>
          <ConfigSwitch
            checked={row.enabled}
            label={row.title}
            onChange={() => onToggle(row, !row.enabled!)}
          />
        </div>
      )}
    </div>
  );
}
