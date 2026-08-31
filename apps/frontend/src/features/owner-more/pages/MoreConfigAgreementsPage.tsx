import { useConfiguredHostelId } from '../hooks/useConfiguredHostel';
import { useNavigate } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { useAgreementTemplate, useAgreementTemplates } from '../hooks/useAgreements';
import { useHostelPolicy } from '@features/settings/settingsHooks';
import { countClauses } from '../config/agreements';
import { agreementRows } from '../config/agreementSections';
import { ChevronRight } from 'lucide-react';

/**
 * Configuration › Agreements — the owner's leasing documents.
 *
 * Two rows differ from the supplied design because the data does not support
 * it, and both are named honestly rather than dressed up:
 *
 * - **Dynamic variables** reports how many of the **eight** real substitution
 *   variables this template uses, not the mockup's eighteen. The set is defined
 *   by `agreement-generation-service.ts`; a token outside it renders literally
 *   in the tenant's agreement.
 * - **Signatures**, not "E-signature · Aadhaar OTP". Signing is a captured
 *   signature image — owner stamp plus the tenant's signature on activation.
 *   No Aadhaar integration exists anywhere in the codebase.
 */
export function MoreConfigAgreementsPage() {
  const navigate = useNavigate();
  const { templates, isLoading: listLoading } = useAgreementTemplates();
  const { active, rules, signatureConfigured, isLoading: contentLoading } = useAgreementTemplate();
  
  const policyQuery = useHostelPolicy(useConfiguredHostelId());

  const hostelId = useConfiguredHostelId();
  const rows = agreementRows({
    hostelId,
    templateCount: templates.length,
    version: Number(active?.version_number ?? 0) || 0,
    clauseCount: countClauses(rules).clauses,
    // Absent means required, matching the backend default.
    agreementRequired: policyQuery.data?.policy?.tenant_rules?.agreement_required !== false,
    hasSignature: signatureConfigured,
  });

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader
        title="Agreements"
        subtitle="Your leasing documents, end to end"
      />

      {!listLoading && !contentLoading && (
        <div className="flex items-start gap-4 rounded-[20px] bg-foreground p-5 shadow-[0_12px_30px_rgba(34,30,26,0.24)]">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] bg-background/10 text-background">
            <FileText className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[15px] font-bold tracking-tight text-background">
              {templates.length === 1 ? '1 template, one system' : `${templates.length} templates, one system`}
            </div>
            <div className="mt-1 text-[12.5px] leading-relaxed text-background/60">
              Build once from shared clauses &amp; variables. Publish, sign, and version like a
              document — not a form.
            </div>
          </div>
        </div>
      )}

      {/*
        One flat list. This was four headings over seven rows, three of which
        opened a screen another row already opened or a route that never
        existed — see config/agreementSections.ts.
      */}
      <div className="overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
        {rows.map((row, i) => (
          <button
            key={row.key}
            type="button"
            onClick={() => navigate(row.route)}
            className={`flex w-full items-center gap-3 px-4 py-3.5 text-left ${i === 0 ? '' : 'border-t border-border/60'}`}
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[14.5px] font-bold text-foreground">{row.label}</span>
              <span className="mt-0.5 block text-[11.5px] leading-[1.45] text-muted-foreground">{row.hint}</span>
              {row.detail && (
                <span className="mt-1 block text-[11.5px] font-semibold text-foreground/70">{row.detail}</span>
              )}
            </span>
            <ChevronRight className="h-4 w-4 flex-none text-muted-foreground/50" strokeWidth={2} />
          </button>
        ))}
      </div>
    </div>
  );
}
