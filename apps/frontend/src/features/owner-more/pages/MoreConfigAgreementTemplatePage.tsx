import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { useAgreementTemplate } from '../hooks/useAgreements';
import { countClauses, splitByVariables, usedVariables } from '../config/agreements';

/**
 * Configuration › Agreements › a template.
 *
 * The preview renders the template's real `rules_content` with every
 * `{{VARIABLE}}` token highlighted, so an owner can see exactly which parts
 * auto-fill per tenant before publishing. Splitting is done by
 * `splitByVariables`, which is unit-tested — a preview that highlights the
 * wrong span would quietly mislead.
 */
export function MoreConfigAgreementTemplatePage() {
  const { active, rules, hasDraft, isLoading } = useAgreementTemplate();
  const variables = usedVariables(rules);
  const clauses = countClauses(rules);
  const categories = rules?.categories ?? [];

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader
        title={active?.title ?? 'Agreement template'}
        subtitle={
          isLoading
            ? 'Loading…'
            : `Version ${active?.version_number ?? 1} · ${hasDraft ? 'Unpublished draft' : active?.status === 'PUBLISHED' ? 'Published' : 'Draft'}`
        }
      />

      {!isLoading && (
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
              hasDraft || active?.status !== 'PUBLISHED'
                ? 'bg-[color:var(--warning)]/15 text-[color:var(--warning)]'
                : 'bg-[color:var(--success)]/15 text-[color:var(--success)]'
            }`}
          >
            {hasDraft ? 'Draft changes' : active?.status === 'PUBLISHED' ? 'Published' : 'Draft'}
          </span>
          <span className="text-[11.5px] text-muted-foreground">
            {variables.length} variable{variables.length === 1 ? '' : 's'} auto-fill per tenant
          </span>
        </div>
      )}

      {categories.length > 0 && (
        <div className="rounded-[20px] border border-border bg-card p-5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="mb-4 text-center text-[12px] font-bold uppercase tracking-[0.14em] text-foreground">
            {active?.title ?? 'Agreement'}
          </div>
          <div className="flex flex-col gap-4">
            {categories.map((category) => (
              <div key={category.id}>
                <div className="text-[12.5px] font-bold text-foreground">{category.title}</div>
                {[...(category.highlights ?? []), ...(category.rules ?? [])].map((line, index) => (
                  <p key={index} className="mt-1.5 text-[12.5px] leading-relaxed text-muted-foreground">
                    {splitByVariables(line).map((part, partIndex) =>
                      part.isVariable ? (
                        <span
                          key={partIndex}
                          className="rounded bg-primary/12 px-1 py-0.5 font-semibold text-primary"
                        >
                          {`{${part.text}}`}
                        </span>
                      ) : (
                        <span key={partIndex}>{part.text}</span>
                      ),
                    )}
                  </p>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {categories.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <div className="pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Clauses in this template · {clauses.clauses}
          </div>
          <div className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <span
                key={category.id}
                className="rounded-full border border-border bg-card px-3 py-1.5 text-[11.5px] text-foreground/80"
              >
                {category.title.replace(/^\d+\.\s*/, '')}
              </span>
            ))}
          </div>
        </div>
      )}

      {!isLoading && categories.length === 0 && (
        <p className="rounded-[18px] border border-dashed border-border bg-card px-4 py-6 text-center text-[12.5px] text-muted-foreground">
          This template has no clause content yet.
        </p>
      )}
    </div>
  );
}
