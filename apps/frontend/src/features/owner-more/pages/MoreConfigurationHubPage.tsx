import { useNavigate } from 'react-router-dom';
import { ChevronRight, LogOut } from 'lucide-react';
import { useProfileHeader } from '../hooks/useProfileHeader';
import { useMoreNav } from '../hooks/useMoreNav';
import { hubGroups } from '../config/hubSections';

/**
 * Owner Profile.
 *
 * Subtracted from twice. It was nine stacked blocks — a progress ring, six
 * module cards, a recent-changes strip, a quick-actions row repeating the
 * modules directly beneath it, and an "Advanced" expander of permanent "Not
 * available yet" placeholders — none of which answered the question the screen
 * exists to answer: *where do I go to change this?* That collapsed to a flat
 * grouped list of labels and chevrons.
 *
 * It is now the owner's own account and nothing else: four rows, a header that
 * names them, and a way out. Notices moved to the hostel it posts to, Requests
 * was a second and poorer door to `/owner/alerts/requests`, About was three
 * links and a mocked version string now at the foot of Help, and search
 * indexed eight per-hostel screens that had already moved to the hostel — with
 * four rows on screen there is nothing left to search for. The needs-attention
 * warnings survive on the hostel that owns them, where they can finally say
 * which hostel they mean (`config/attentionItems.ts`).
 *
 * The header names the owner, not the workspace. It used to read "*hostel*
 * workspace" over the hostel's initials while every row beneath it was
 * owner-level — their details, their password, their bank account — so it
 * named the one thing the screen does not configure.
 *
 * Grouping and header identity live in `config/hubSections.ts` and
 * `config/profileIdentity.ts` so they can be asserted without rendering.
 */
export function MoreConfigurationHubPage() {
  const navigate = useNavigate();
  const { signOut } = useMoreNav();
  const identity = useProfileHeader();

  const groups = hubGroups();

  return (
    <div className="flex flex-col gap-6 px-4 pb-8 pt-6 sm:px-6">
      <div className="flex items-center gap-3.5">
        {/*
          The photo when there is one, initials when there is not — never an
          empty circle, which reads as a broken image rather than as loading.
        */}
        {identity.photoUrl ? (
          <img
            src={identity.photoUrl}
            alt=""
            className="h-14 w-14 flex-none rounded-full object-cover shadow-[0_4px_10px_rgba(180,106,85,0.32)]"
          />
        ) : (
          <span className="flex h-14 w-14 flex-none items-center justify-center rounded-full bg-primary font-display text-[17px] font-bold text-primary-foreground shadow-[0_4px_10px_rgba(180,106,85,0.32)]">
            {identity.initials}
          </span>
        )}
        <div className="flex min-w-0 flex-col gap-0.5">
          <h1 className="truncate font-display text-[22px] font-extrabold tracking-tight text-foreground">
            {identity.name}
          </h1>
          {identity.sub && <p className="truncate text-[12.5px] text-muted-foreground">{identity.sub}</p>}
        </div>
      </div>

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
                className={`flex w-full items-center gap-3 px-4 py-3.5 text-left ${i === 0 ? '' : 'border-t border-border/60'}`}
              >
                <span className="min-w-0 flex-1 truncate text-[14.5px] font-medium text-foreground">{row.label}</span>
                <ChevronRight className="h-4 w-4 flex-none text-muted-foreground/50" strokeWidth={2} />
              </button>
            ))}
          </div>
        </section>
      ))}

      <button
        type="button"
        onClick={signOut}
        className="flex items-center justify-center gap-2 rounded-[14px] border border-border bg-card px-4 py-3.5 text-[14px] font-semibold text-destructive"
      >
        <LogOut className="h-4 w-4" strokeWidth={2} />
        Sign out
      </button>
    </div>
  );
}
