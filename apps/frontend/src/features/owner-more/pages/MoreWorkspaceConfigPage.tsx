import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle } from 'lucide-react';
import { ListRow } from '@shared/ui-patterns/ListRow';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { useWorkspaceConfig } from '../hooks/useWorkspaceConfig';

const card = 'overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';

/** More → Workspace Configuration — real checklist, see useWorkspaceConfig for what each item actually checks. */
export function MoreWorkspaceConfigPage() {
  const navigate = useNavigate();
  const { items, percentComplete, remainingCount, isLoading } = useWorkspaceConfig();

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader backTo="/owner/more" backLabel="More" title="Workspace Configuration" />

      <div className={`${card} px-4 py-4`}>
        <div className="flex items-center justify-between">
          <span className="font-display text-[14.5px] font-bold text-foreground">
            {isLoading ? 'Loading…' : `${percentComplete}% complete`}
          </span>
          {!isLoading && (
            <span className="text-[11.5px] text-muted-foreground">
              {remainingCount === 0 ? 'All set' : `${remainingCount} to finish`}
            </span>
          )}
        </div>
        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percentComplete}%` }} />
        </div>
      </div>

      <div className={card}>
        {items.map((item) => (
          <ListRow
            key={item.id}
            leading={
              item.done ? (
                <CheckCircle2 className="h-5 w-5 text-primary" strokeWidth={1.8} />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground/40" strokeWidth={1.8} />
              )
            }
            title={item.label}
            meta={item.caption}
            showChevron={Boolean(item.route)}
            onClick={item.route ? () => navigate(item.route!) : undefined}
            className="px-4"
          />
        ))}
      </div>
    </div>
  );
}
