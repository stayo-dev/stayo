import { Users } from 'lucide-react';
import { EmptyState } from '@shared/ui-patterns/EmptyState';
import type { MockTenant } from '@shared/mocks/tenants';
import { TenantRow } from './TenantRow';

interface TenantListProps {
  tenants: MockTenant[];
  onSelect: (tenant: MockTenant) => void;
  onInvite: () => void;
  showHostel?: boolean;
}

/** Tenant rows or the "no tenants" empty state, per Stayo App.dc.html. */
export function TenantList({ tenants, onSelect, onInvite, showHostel }: TenantListProps) {
  if (tenants.length === 0) {
    return (
      <EmptyState
        icon={<Users className="h-5 w-5" strokeWidth={2} />}
        title="No tenants match"
        description="Try a different hostel, filter, or search."
        action={
          <button
            type="button"
            onClick={onInvite}
            className="rounded-xl bg-primary px-5 py-2.5 font-display text-sm font-bold text-primary-foreground"
          >
            Invite First Tenant
          </button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {tenants.map((t) => (
        <TenantRow key={t.id} tenant={t} onClick={() => onSelect(t)} showHostel={showHostel} />
      ))}
    </div>
  );
}
