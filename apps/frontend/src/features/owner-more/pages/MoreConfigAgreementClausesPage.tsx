import { useMutation, useQueryClient } from '@tanstack/react-query';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { useAgreementTemplate } from '../hooks/useAgreements';
import { configApi } from '../api/configApi';
import { countClauses, severityLabel, type RulesContent } from '../config/agreements';

/**
 * Configuration › Agreements › Clause library.
 *
 * A **per-template** clause manager, not a cross-template library: clauses live
 * inside each template's own `rules_content`, and a shared library would need a
 * new table plus a backfill (deliberately deferred — see the slice spec). This
 * covers the owner's actual job: deciding which sections their agreement
 * contains.
 *
 * Toggling writes the whole `rules_content` back as a **draft** via the existing
 * endpoint. Publishing stays a separate, deliberate action, so an owner can
 * reshape an agreement without it taking effect for tenants mid-edit.
 *
 * Badges show the stored `severity` (Important / Standard) rather than the
 * mockup's Core/Policy/Optional, which would be a label invented over the data.
 */
export function MoreConfigAgreementClausesPage() {
  const { rules, hostelId, isLoading, hasDraft } = useAgreementTemplate();
  const queryClient = useQueryClient();
  const categories = rules?.categories ?? [];
  const counts = countClauses(rules);

  const saveMutation = useMutation({
    mutationFn: (next: RulesContent) => configApi.saveAgreementDraft(hostelId!, next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner', 'agreement-template', hostelId] });
      queryClient.invalidateQueries({ queryKey: ['owner', 'agreement-templates', hostelId] });
      stayoToast.success('Saved as draft');
    },
    onError: () => stayoToast.error('Could not save clause changes'),
  });

  const toggleCategory = (categoryId: string, next: boolean) => {
    if (!rules || !hostelId) return;
    saveMutation.mutate({
      ...rules,
      categories: categories.map((category) =>
        category.id === categoryId ? { ...category, enabled: next } : category,
      ),
    });
  };

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader
        title="Clause library"
        subtitle="Reusable blocks for every template"
      />

      {!isLoading && (
        <div className="flex items-center justify-between gap-3 rounded-[16px] bg-secondary px-4 py-3">
          <span className="text-[12.5px] text-foreground/80">
            {counts.categories} section{counts.categories === 1 ? '' : 's'} · {counts.clauses} clause
            {counts.clauses === 1 ? '' : 's'}
          </span>
          {hasDraft && (
            <span className="rounded-full bg-[color:var(--warning)]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[color:var(--warning)]">
              Unpublished draft
            </span>
          )}
        </div>
      )}

      <div className="overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
        {categories.map((category, index) => {
          // Absent `enabled` means included — existing templates predate the flag.
          const enabled = category.enabled !== false;
          const clauseCount =
            (category.highlights?.length ?? 0) + (category.rules?.length ?? 0);

          return (
            <div
              key={category.id}
              className={`flex items-start gap-3 px-4 py-3.5 ${index === 0 ? '' : 'border-t border-border/60'}`}
            >
              <div className="min-w-0 flex-1">
                <div className="text-[14px] font-semibold text-foreground">
                  {category.title.replace(/^\d+\.\s*/, '')}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
                    {severityLabel(category.severity)}
                  </span>
                  <span className="text-[11.5px] text-muted-foreground">
                    {clauseCount} clause{clauseCount === 1 ? '' : 's'}
                  </span>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={category.title}
                disabled={saveMutation.isPending}
                onClick={() => toggleCategory(category.id, !enabled)}
                className={`relative mt-0.5 h-[25px] w-[42px] flex-none rounded-full transition-colors disabled:opacity-50 ${
                  enabled ? 'bg-primary' : 'bg-muted'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-[21px] w-[21px] rounded-full bg-white shadow transition-transform ${
                    enabled ? 'translate-x-[17px]' : 'translate-x-0.5'
                  }`}
                />
              </button>
            </div>
          );
        })}

        {!isLoading && categories.length === 0 && (
          <p className="px-4 py-6 text-center text-[12.5px] text-muted-foreground">
            No clause sections yet.
          </p>
        )}
      </div>

      <p className="text-center text-[11.5px] leading-relaxed text-muted-foreground">
        Changes save as a draft. Existing tenants keep the version they signed.
      </p>
    </div>
  );
}
