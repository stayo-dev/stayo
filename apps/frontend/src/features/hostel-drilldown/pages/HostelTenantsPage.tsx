import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { TenantList } from '@features/owner-tenants/components/TenantList';
import { InviteTenantWizard } from '@features/owner-tenants/invite/InviteTenantWizard';
import { mockTenants } from '@shared/mocks/tenants';

/** Hostel Drill-down → Tenants sub-tab, per Stayo App.dc.html — reuses the main Tenants tab's list/row components, filtered to this hostel. */
export function HostelTenantsPage() {
  const { hostelId } = useParams<{ hostelId: string }>();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);

  const hostelTenants = useMemo(() => mockTenants.filter((t) => t.hostelId === hostelId), [hostelId]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return hostelTenants;
    return hostelTenants.filter((t) => t.name.toLowerCase().includes(q) || t.room.toLowerCase().includes(q) || t.phone.includes(q));
  }, [hostelTenants, search]);

  const totalDue = hostelTenants.reduce((sum, t) => sum + t.outstanding, 0);
  const overdueCount = hostelTenants.filter((t) => t.status === 'overdue').length;

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex gap-2">
        <div className="flex-1 rounded-2xl border border-border bg-card p-2.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="font-display text-base font-extrabold tabular-nums text-destructive">₹{(totalDue / 100000).toFixed(1)}L</div>
          <div className="text-[10.5px] text-muted-foreground">total due</div>
        </div>
        <div className="flex-1 rounded-2xl border border-border bg-card p-2.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="font-display text-base font-extrabold tabular-nums text-foreground">{overdueCount}</div>
          <div className="text-[10.5px] text-muted-foreground">overdue</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-[11px] border border-border bg-card px-3 py-2.5">
          <Search className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.6} />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, room…" className="min-w-0 flex-1 bg-transparent text-[12.5px] text-foreground focus:outline-none" />
        </div>
        <button type="button" onClick={() => setInviteOpen(true)} className="flex-none rounded-[10px] bg-primary px-3.5 py-2.5 font-display text-xs font-bold text-primary-foreground">
          + Add
        </button>
      </div>

      <TenantList tenants={filtered} onSelect={(t) => navigate(`/owner/tenants/${t.id}`)} onInvite={() => setInviteOpen(true)} />

      <InviteTenantWizard open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
