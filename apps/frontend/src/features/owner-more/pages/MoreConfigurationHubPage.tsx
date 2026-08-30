import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, ChevronRight, AlertTriangle, LogOut } from 'lucide-react';
import { useConfigurationHub } from '../hooks/useConfigurationHub';
import { useMoreNav } from '../hooks/useMoreNav';
import { ConfigSearchOverlay } from '../components/ConfigSearchOverlay';
import { hubGroups, visibleAttention } from '../config/hubSections';

/**
 * Owner Configuration hub.
 *
 * Rebuilt as a flat, grouped list. It was nine stacked blocks — a progress
 * ring, an attention list, six module *cards* each carrying an icon, title,
 * subtitle, status badge and area count, a recent-changes strip, a
 * quick-actions row repeating three destinations listed directly beneath it,
 * and an "Advanced" expander whose six rows were all permanent "Not available
 * yet" placeholders. Reaching a setting meant scrolling past roughly three
 * screens of furniture.
 *
 * None of it answered the question the screen exists to answer: *where do I go
 * to change this?* So a row is now a label and a chevron, grouped under a
 * heading, ~44px instead of ~90px.
 *
 * What survives the cut is what is actionable: search, and at most two
 * "needs attention" lines derived from real gaps (a missing GST number, a late
 * fee switched on with no amount). The completeness ring goes; the signal it
 * decorated stays.
 *
 * Grouping and capping live in `config/hubSections.ts` so they can be asserted
 * without rendering. See the configuration redesign spec.
 */
export function MoreConfigurationHubPage() {
  const navigate = useNavigate();
  const { signOut } = useMoreNav();
  const { workspaceName, workspaceInitials, attention } = useConfigurationHub();
  const [searchOpen, setSearchOpen] = useState(false);

  const groups = hubGroups();
  const needsAttention = visibleAttention(attention);

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
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Configuration</h1>
          <p className="truncate text-[12.5px] text-muted-foreground">{workspaceName}</p>
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

      {/*
        Kept, where the ring was not: these lines name a specific gap and go
        straight to the screen that closes it. Capped at two — an unbounded
        list would rebuild the wall this screen just lost.
      */}
      {needsAttention.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h2 className="pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Needs attention
          </h2>
          <div className="overflow-hidden rounded-[14px] border border-border bg-card">
            {needsAttention.map((item, i) => (
              <button
                key={item.title}
                type="button"
                onClick={() => navigate(item.route)}
                className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left ${i === 0 ? '' : 'border-t border-border/60'}`}
              >
                <AlertTriangle className="h-[15px] w-[15px] flex-none text-[#B8792B]" strokeWidth={2} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{item.title}</span>
                <ChevronRight className="h-4 w-4 flex-none text-muted-foreground/50" strokeWidth={2} />
              </button>
            ))}
          </div>
        </section>
      )}

      {groups.map((group) => (
        <section key={group.label} className="flex flex-col gap-1.5">
          <h2 className="pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {group.label}
          </h2>
          <div className="overflow-hidden rounded-[14px] border border-border bg-card">
            {group.rows.map((row, i) => (
              <button
                key={row.key}
                type="button"
                onClick={() => navigate(row.route)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-left ${i === 0 ? '' : 'border-t border-border/60'}`}
              >
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-foreground">{row.label}</span>
                <ChevronRight className="h-4 w-4 flex-none text-muted-foreground/50" strokeWidth={2} />
              </button>
            ))}
          </div>
        </section>
      ))}

      <button
        type="button"
        onClick={signOut}
        className="flex items-center justify-center gap-2 rounded-[14px] border border-border bg-card px-4 py-3 text-[14px] font-semibold text-destructive"
      >
        <LogOut className="h-4 w-4" strokeWidth={2} />
        Sign out
      </button>
    </div>
  );
}
