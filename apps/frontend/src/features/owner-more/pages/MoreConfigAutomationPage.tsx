import { useConfiguredHostelId } from '../hooks/useConfiguredHostel';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useHostelPolicy, useUpdateHostelPolicy } from '@features/settings/settingsHooks';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { ConfigWorkflowRow } from '../components/ConfigWorkflowRow';
import {
  buildWorkflowPatch,
  countWorkflows,
  deriveAutomationSections,
  type ConfigWorkflowRow as WorkflowRow,
} from '../config/deriveAutomationSections';

/**
 * Configuration › Automation — work that runs without the owner.
 *
 * Every toggle writes `policy.automation` or `policy.reminders.channels`,
 * and those flags gate real cron jobs under `app/api/cron/`. Because the write
 * goes through `PATCH /api/hostels/:id/preferences`, each flip is also recorded
 * by the config change log and appears in the hub's Recent Changes — the
 * timeline and the toggles came from the same slice on purpose.
 *
 * Grouped by what each workflow does for the owner rather than by the system
 * that runs it, which is where the supplied design genuinely improves on the
 * data model's own shape.
 */
export function MoreConfigAutomationPage() {
  
  const hostelId = useConfiguredHostelId();
  const policyQuery = useHostelPolicy(hostelId);
  const updateMutation = useUpdateHostelPolicy(hostelId ?? '');

  const sections = deriveAutomationSections({
    automation: policyQuery.data?.policy?.automation ?? null,
    channels: policyQuery.data?.policy?.reminders?.channels ?? null,
  });
  const { running, total } = countWorkflows(sections.flatMap((s) => s.rows));

  const toggle = (row: WorkflowRow, next: boolean) => {
    const patch = buildWorkflowPatch(row, next);
    if (!patch || !hostelId) return;

    updateMutation.mutate(patch, {
      onSuccess: () => stayoToast.success(`${row.title} ${next ? 'turned on' : 'paused'}`),
      onError: () => stayoToast.error(`Could not update ${row.title.toLowerCase()}`),
    });
  };

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader
        backTo="/owner/more"
        backLabel="Configuration"
        title="Automation"
        subtitle="Work that runs without you"
      />

      {!policyQuery.isLoading && (
        <div className="rounded-[16px] bg-[color:var(--success)]/10 px-4 py-3.5">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-[color:var(--success)]" />
            <span className="text-[13.5px] font-bold text-[color:var(--success)]">
              {running} of {total} workflows running
            </span>
          </div>
          <div className="mt-1 text-[12px] text-[color:var(--success)]/80">
            Grouped by what they do for you, not by channel.
          </div>
        </div>
      )}

      {sections.map((section) => (
        <div key={section.label} className="flex flex-col gap-2.5">
          <div className="pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {section.label}
          </div>
          <div className="overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
            {section.rows.map((row, index) => (
              <ConfigWorkflowRow
                key={row.key}
                row={row}
                onToggle={toggle}
                isPending={updateMutation.isPending}
                className={index === 0 ? '' : 'border-t border-border/60'}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
