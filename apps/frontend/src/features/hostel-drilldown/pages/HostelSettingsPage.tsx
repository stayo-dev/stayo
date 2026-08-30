import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { hostelSettingsGroups } from '../settings/hostelSettingsSections';

/**
 * Hostel → Settings.
 *
 * Everything configurable about *this* hostel, moved out of the Configure
 * section. Hostels are managed from Home, so Configure holding a second,
 * competing hostel section made an owner guess which of the two places a
 * setting lived in — and let a multi-hostel owner edit one hostel's rules
 * while the header named another.
 *
 * Rows state what they govern rather than naming a policy object: "What
 * happens when rent is late", not "Late fees". The hint under each is what
 * lets an owner pick the right row without opening two of them.
 *
 * Archiving deliberately stays on Overview rather than moving here. That copy
 * of `ArchiveHostelModal` is handed the hostel's active tenant count and
 * outstanding dues, so it can warn with real numbers; this screen has neither.
 * A second, weaker door to a destructive action is worse than one good one.
 */
export function HostelSettingsPage() {
  const { hostelId } = useParams<{ hostelId: string }>();
  const navigate = useNavigate();

  const groups = hostelSettingsGroups(hostelId ?? '');

  return (
    <div className="flex flex-col gap-5 pb-8">
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
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold text-foreground">{row.label}</span>
                  <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">{row.hint}</span>
                </span>
                <ChevronRight className="h-4 w-4 flex-none text-muted-foreground/50" strokeWidth={2} />
              </button>
            ))}
          </div>
        </section>
      ))}

    </div>
  );
}
