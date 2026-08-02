import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { ListRow } from '@shared/ui-patterns/ListRow';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { mockTenantDefaults } from '@shared/mocks/more';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { useMoreNav } from '../hooks/useMoreNav';

const card = 'overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

/** More → Settings, per Stayo App.dc.html. Hostel identity, rent & billing, tenant defaults, and my profile are all real. */
export function MoreSettingsPage() {
  const navigate = useNavigate();
  const { signOut } = useMoreNav();
  const session = useOwnerSession();
  const primaryHostel = session.hostels.find((h) => h.id === session.primaryHostelId);

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader backTo="/owner/more" backLabel="More" title="Settings" />

      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Hostel setup</span>
        <div className={card}>
          <ListRow
            leading={<span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-secondary font-display text-sm font-bold text-primary">H</span>}
            title="Hostel identity"
            meta={primaryHostel ? `${primaryHostel.name} · ${session.hostels.length} hostel${session.hostels.length === 1 ? '' : 's'}` : 'Loading…'}
            showChevron
            onClick={() => navigate('/owner/more/hostel')}
            className="px-4"
          />
          <ListRow
            leading={<span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-secondary font-display text-xs font-bold text-primary">RB</span>}
            title="Rent and billing"
            meta="Schedule, due dates & late fees"
            showChevron
            onClick={() => navigate('/owner/more/billing')}
            className="px-4"
          />
          <ListRow
            leading={<span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-secondary font-display text-xs font-bold text-primary">TD</span>}
            title="Tenant defaults"
            meta={mockTenantDefaults}
            showChevron
            onClick={() => navigate('/owner/more/configuration/hostel/tenant-defaults')}
            className="px-4"
          />
          <ListRow
            leading={<span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-secondary font-display text-xs font-bold text-primary">N</span>}
            title="Notices"
            meta="Announcements & upcoming events"
            showChevron
            onClick={() => navigate('/owner/more/notices')}
            className="px-4"
          />
          <ListRow
            leading={<span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-secondary font-display text-xs font-bold text-primary">SR</span>}
            title="Service Requests"
            meta="Tenant maintenance & room requests"
            showChevron
            onClick={() => navigate('/owner/more/service-requests')}
            className="px-4"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Account</span>
        <div className={card}>
          <ListRow
            leading={<span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary font-display text-xs font-bold text-primary-foreground">{(session.ownerName || 'O')[0]}</span>}
            title="My profile"
            meta="View and edit your details"
            showChevron
            onClick={() => navigate('/owner/more/profile')}
            className="px-4"
          />
        </div>
      </div>

      <div className={card}>
        <ListRow
          leading={
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-destructive/10 text-destructive">
              <LogOut className="h-4 w-4" strokeWidth={1.8} />
            </span>
          }
          title={<span className="text-destructive">Sign out</span>}
          onClick={signOut}
          className="px-4"
        />
      </div>
    </div>
  );
}
