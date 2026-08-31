import { useNavigate } from 'react-router-dom';
import { FileText, ChevronRight } from 'lucide-react';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { useAgreementTemplates } from '../hooks/useAgreements';
import { summarizeTemplate } from '../config/agreements';

/**
 * Configuration › Agreements › Templates.
 *
 * Every figure is real: the version and tenant count come from
 * `version_number` and the template's `agreements` relation, and "Edited N days
 * ago" from `updated_at`. A published template with no agreements reads "Not
 * used yet" rather than "0 tenants", which looks like a fault.
 *
 * There is no "New template" action yet: creating one means choosing a type and
 * seeding clause content, which is the next slice. Rather than show a button
 * that cannot work, the screen says where templates come from.
 */
export function MoreConfigAgreementTemplatesPage() {
  const navigate = useNavigate();
  const { templates, isLoading } = useAgreementTemplates();
  const draftCount = templates.filter((t) => t.status !== 'PUBLISHED').length;

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader
        title="Templates"
        subtitle={
          isLoading
            ? 'Loading…'
            : `${templates.length} document${templates.length === 1 ? '' : 's'}${draftCount > 0 ? ` · ${draftCount} in draft` : ''}`
        }
      />

      <div className="flex flex-col gap-[10px]">
        {templates.map((template) => {
          const summary = summarizeTemplate(template);
          return (
            <button
              key={template.id}
              type="button"
              onClick={() => navigate('/owner/more/configuration/agreements/template')}
              className="flex items-center gap-3.5 rounded-[18px] border border-border bg-card px-4 py-3.5 text-left shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]"
            >
              <span className="flex h-10 w-10 flex-none items-center justify-center rounded-[11px] bg-secondary text-primary">
                <FileText className="h-[18px] w-[18px]" strokeWidth={1.7} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14.5px] font-bold text-foreground">
                  {template.title}
                </span>
                <span className="mt-1 flex items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${
                      summary.isDraft
                        ? 'bg-[color:var(--warning)]/15 text-[color:var(--warning)]'
                        : 'bg-[color:var(--success)]/15 text-[color:var(--success)]'
                    }`}
                  >
                    {summary.statusLabel}
                  </span>
                  <span className="truncate text-[11.5px] text-muted-foreground">{summary.detail}</span>
                </span>
              </span>
              <ChevronRight className="h-4 w-4 flex-none text-muted-foreground/50" strokeWidth={2} />
            </button>
          );
        })}

        {!isLoading && templates.length === 0 && (
          <p className="rounded-[18px] border border-dashed border-border bg-card px-4 py-6 text-center text-[12.5px] text-muted-foreground">
            No templates yet. One is created automatically from the Stayo default when your first
            tenant is activated.
          </p>
        )}
      </div>
    </div>
  );
}
