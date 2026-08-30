import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronDown, Settings2, HelpCircle, Info, LogOut } from 'lucide-react';
import { ListRow } from '@shared/ui-patterns/ListRow';
import { useConfigurationHub } from '../hooks/useConfigurationHub';
import { useMoreNav } from '../hooks/useMoreNav';
import { ConfigProgressRing } from '../components/ConfigProgressRing';
import { ConfigAttentionRow } from '../components/ConfigAttentionRow';
import { ConfigModuleCard } from '../components/ConfigModuleCard';
import { ConfigSearchOverlay } from '../components/ConfigSearchOverlay';
import { ConfigSettingRow } from '../components/ConfigSettingRow';
import { ConfigRecentChanges } from '../components/ConfigRecentChanges';
import { useConfigChanges } from '../hooks/useConfigChanges';
import { UNAVAILABLE_LABEL, type ConfigRow } from '../config/configRows';

const card = 'overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

const QUICK_ACTIONS = [
  { label: 'Hostel identity', route: '/owner/more/hostel' },
  { label: 'Rent rules', route: '/owner/more/configuration/finance' },
  { label: 'Late fees', route: '/owner/more/configuration/finance/late-fees' },
];

/**
 * None of these have an owner-facing route yet — verified, not assumed: there
 * is no import or export screen under the owner router, and no backups, API or
 * danger-zone feature at all. They previously rendered as ordinary rows with no
 * `onClick`, which looks tappable and does nothing; they now say so explicitly.
 */
const ADVANCED_ROWS: ConfigRow[] = [
  'Import data',
  'Export',
  'Backups',
  'Activity logs',
  'API & webhooks',
  'Danger zone',
].map((title) => ({ key: title, title, detail: UNAVAILABLE_LABEL, state: 'unavailable' as const }));

/** Owner Configuration hub — Phase 1: real Hostel + Finance modules only. See the approved plan for what's deferred and why. */
export function MoreConfigurationHubPage() {
  const navigate = useNavigate();
  const {
    modules,
    attention,
    percentComplete,
    doneCount,
    totalCount,
    isLoading,
    workspaceName,
    workspaceInitials,
  } = useConfigurationHub();
  const { changes } = useConfigChanges();
  const { signOut } = useMoreNav();
  const [searchOpen, setSearchOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  if (searchOpen) {
    return (
      <ConfigSearchOverlay
        onClose={() => setSearchOpen(false)}
        onNavigate={(target) => {
          setSearchOpen(false);
          navigate(target);
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6 px-4 pb-8 pt-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Configuration</h1>
          <p className="text-[12.5px] text-muted-foreground">{workspaceName}</p>
        </div>
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-primary font-display text-[13px] font-bold text-primary-foreground shadow-[0_4px_10px_rgba(180,106,85,0.32)]">
          {workspaceInitials}
        </span>
      </div>

      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        className="flex items-center gap-2.5 rounded-[13px] border border-border bg-card px-3.5 py-3 text-left"
      >
        <Search className="h-[15px] w-[15px] flex-none text-muted-foreground" strokeWidth={1.6} />
        <span className="flex-1 text-[13px] text-muted-foreground">Search any setting or action…</span>
      </button>

      <div className="rounded-[22px] bg-foreground p-5 shadow-[0_12px_30px_rgba(34,30,26,0.24)]">
        <div className="flex items-center gap-[18px]">
          <ConfigProgressRing percent={percentComplete} />
          <div className="min-w-0 flex-1">
            <div className="font-display text-[15px] font-bold tracking-tight text-background">
              {isLoading
                ? 'Loading…'
                : doneCount === totalCount
                  ? 'Workspace fully configured'
                  : 'Workspace mostly configured'}
            </div>
            <div className="mt-[3px] text-[12.5px] text-background/60">
              {isLoading
                ? ''
                : `${doneCount} of ${totalCount} modules set up${attention.length > 0 ? ` · ${attention.length} item${attention.length === 1 ? '' : 's'} need attention` : ''}`}
            </div>
          </div>
        </div>
      </div>

      {attention.length > 0 && (
        <div className="flex flex-col gap-[11px]">
          <div className={sectionLabel}>Needs attention</div>
          <div className="flex flex-col gap-[9px]">
            {attention.map((item) => (
              <ConfigAttentionRow key={item.title} title={item.title} sub={item.sub} onClick={() => navigate(item.route)} />
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className={sectionLabel}>Configuration modules</div>
        <div className="flex flex-col gap-[10px]">
          {modules.map((m) => (
            <ConfigModuleCard
              key={m.key}
              glyph={m.glyph}
              title={m.title}
              desc={m.desc}
              status={m.status}
              statusLabel={m.statusLabel}
              meta={m.meta}
              tint={m.tint}
              iconColor={m.iconColor}
              onClick={() => navigate(m.route)}
            />
          ))}
        </div>
      </div>

      <ConfigRecentChanges changes={changes} />

      <div className="flex flex-col gap-3">
        <div className={sectionLabel}>Quick actions</div>
        <div className="flex flex-wrap gap-2">
          {QUICK_ACTIONS.map((qa) => (
            <button
              key={qa.label}
              type="button"
              onClick={() => navigate(qa.route)}
              className="flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2.5 text-[12.5px] font-semibold text-foreground/80"
            >
              <span className="font-bold text-primary">+</span>
              {qa.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          className="flex items-center gap-3 rounded-2xl border border-dashed border-border bg-card px-4 py-3.5 text-left"
        >
          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] bg-secondary text-sm font-semibold text-muted-foreground">⌥</span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold text-foreground">Advanced</div>
            <div className="text-[11px] text-muted-foreground">Import, export, backups, API &amp; danger zone</div>
          </div>
          <ChevronDown className={`h-3.5 w-3.5 flex-none text-muted-foreground/50 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
        </button>
        {advancedOpen && (
          <div className={card}>
            {ADVANCED_ROWS.map((row, i) => (
              <ConfigSettingRow
                key={row.key}
                row={row}
                onNavigate={navigate}
                className={i === 0 ? '' : 'border-t border-border/60'}
              />
            ))}
          </div>
        )}
      </div>

      <div className={card}>
        <ListRow
          leading={
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F5E9E3] text-primary">
              <Settings2 className="h-4 w-4" strokeWidth={1.8} />
            </span>
          }
          title="Account settings"
          meta="Profile, notices, service requests"
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
          className="px-4 border-t border-border/60"
        />
        <ListRow
          leading={
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#F5E9E3] text-primary">
              <Info className="h-4 w-4" strokeWidth={1.8} />
            </span>
          }
          title="About Stayo"
          showChevron
          onClick={() => navigate('/owner/more/about')}
          className="px-4 border-t border-border/60"
        />
        <ListRow
          leading={
            <span className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-destructive/10 text-destructive">
              <LogOut className="h-4 w-4" strokeWidth={1.8} />
            </span>
          }
          title={<span className="text-destructive">Sign out</span>}
          onClick={signOut}
          className="px-4 border-t border-border/60"
        />
      </div>
    </div>
  );
}
