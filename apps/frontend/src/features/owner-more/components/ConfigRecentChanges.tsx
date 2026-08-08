import type { ConfigChangeEntry } from '../hooks/useConfigChanges';

/**
 * The Recent Changes timeline on the Configuration hub.
 *
 * Renders nothing at all when there is no history. That is the honest state
 * rather than an oversight: nothing wrote configuration changes before this
 * shipped, so no backfill is possible and the list fills as an owner makes
 * changes. An empty card headed "Recent changes" would read as a fault.
 */
const MODULE_DOT: Record<string, string> = {
  Finance: 'bg-[color:var(--warning)]',
  Hostel: 'bg-primary',
  Automation: 'bg-[color:var(--success)]',
  Notifications: 'bg-[color:var(--chart-4,#3b5fa8)]',
  Configuration: 'bg-muted-foreground/50',
};

function relativeTime(at: string): string {
  const then = new Date(at);
  const minutes = Math.round((Date.now() - then.getTime()) / 60_000);

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) {
    return `Today, ${then.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
  }

  const days = Math.round(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return then.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export function ConfigRecentChanges({ changes }: { changes: ConfigChangeEntry[] }) {
  if (changes.length === 0) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        Recent changes
      </div>
      <div className="overflow-hidden rounded-[20px] border border-border bg-card px-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
        {changes.map((change, index) => (
          <div
            key={change.id}
            className={`flex items-start gap-3 py-3.5 ${index === 0 ? '' : 'border-t border-border/60'}`}
          >
            <span
              aria-hidden="true"
              className={`mt-[7px] h-[7px] w-[7px] flex-none rounded-full ${
                MODULE_DOT[change.module] ?? MODULE_DOT.Configuration
              }`}
            />
            <div className="min-w-0 flex-1">
              <div className="text-[13.5px] font-semibold text-foreground">{change.label}</div>
              <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                {change.module} · {relativeTime(change.at)} · {change.actor.is_you ? 'You' : change.actor.name}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
