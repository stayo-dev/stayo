import { useNavigate } from 'react-router-dom';
import { Settings2, HelpCircle, Info, LogOut, ChevronRight, FileText, CircleDot } from 'lucide-react';
import { ListRow } from '@shared/ui-patterns/ListRow';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { mockOwnerProfile, mockAgreementsSummary, mockPropertiesSummary } from '@shared/mocks/more';
import { useMoreNav } from '../hooks/useMoreNav';
import { useWorkspaceConfig } from '../hooks/useWorkspaceConfig';

const card = 'overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';

/** More tab landing screen — profile, Workspace Config, Agreements, Properties, Settings, Help & Support, About, Sign out. Central configuration hub, per Stayo App.dc.html plus the two added rows. */
export function MorePage() {
  const navigate = useNavigate();
  const { signOut } = useMoreNav();
  const { percentComplete, remainingCount, isLoading: configLoading } = useWorkspaceConfig();

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-8 pt-6 sm:px-6">
      <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">More</h1>

      <div className={`${card} flex items-center gap-3.5 px-4 py-3.5`}>
        <span className="flex h-12 w-12 flex-none items-center justify-center rounded-full bg-primary font-display text-base font-extrabold text-primary-foreground">
          {mockOwnerProfile.initials}
        </span>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[14.5px] font-bold text-foreground">{mockOwnerProfile.name}</div>
          <div className="text-xs text-muted-foreground">{mockOwnerProfile.role} · {mockOwnerProfile.email}</div>
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate('/owner/more/workspace-configuration')}
        className="flex items-center gap-3.5 rounded-[20px] bg-foreground px-[18px] py-4 text-left shadow-[0_12px_30px_rgba(34,30,26,0.22)]"
      >
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[13px] bg-[rgba(217,144,111,0.18)]">
          <Settings2 className="h-5 w-5 text-[#E5A585]" strokeWidth={1.8} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-display text-[14.5px] font-bold text-background">Workspace Configuration</span>
            {!configLoading && (
              <span className="flex-none rounded-full bg-primary/25 px-2 py-0.5 text-[9.5px] font-semibold text-primary">{percentComplete}%</span>
            )}
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-background/60">
            {configLoading ? 'Loading…' : remainingCount === 0 ? 'All set' : `Finance, agreements & automation · ${remainingCount} to finish`}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 flex-none text-background/50" />
      </button>

      <div className={card}>
        <ListRow
          leading={
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F5E9E3] text-primary">
              <FileText className="h-4 w-4" strokeWidth={1.8} />
            </span>
          }
          title="Agreements"
          meta={mockAgreementsSummary}
          showChevron
          onClick={() => stayoToast.info('Coming soon')}
          className="px-4"
        />
        <ListRow
          leading={
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F5E9E3] text-primary">
              <CircleDot className="h-4 w-4" strokeWidth={1.8} />
            </span>
          }
          title="Properties"
          meta={mockPropertiesSummary}
          showChevron
          onClick={() => stayoToast.info('Coming soon')}
          className="px-4"
        />
      </div>

      <div className={card}>
        <ListRow
          leading={
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F5E9E3] text-primary">
              <Settings2 className="h-4 w-4" strokeWidth={1.8} />
            </span>
          }
          title="Settings"
          showChevron
          onClick={() => navigate('/owner/more/settings')}
          className="px-4"
        />
        <ListRow
          leading={
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F5E9E3] text-primary">
              <HelpCircle className="h-4 w-4" strokeWidth={1.8} />
            </span>
          }
          title="Help & Support"
          showChevron
          onClick={() => navigate('/owner/more/help')}
          className="px-4"
        />
        <ListRow
          leading={
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F5E9E3] text-primary">
              <Info className="h-4 w-4" strokeWidth={1.8} />
            </span>
          }
          title="About StayO"
          showChevron
          onClick={() => navigate('/owner/more/about')}
          className="px-4"
        />
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

      <p className="pt-1 text-center text-[11px] text-muted-foreground/70">Stayo v2.0 · Manage. Automate. Grow.</p>
    </div>
  );
}
