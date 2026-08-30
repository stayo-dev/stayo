import { useNavigate } from 'react-router-dom';
import { FileText } from 'lucide-react';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { ConfigSectionGroup } from '../components/ConfigSectionGroup';
import { useAgreementTemplate, useAgreementTemplates } from '../hooks/useAgreements';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useHostelPolicy } from '@features/settings/settingsHooks';
import { deriveAgreementSections } from '../config/agreements';

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
  const { rules, signatureConfigured, isLoading: contentLoading } = useAgreementTemplate();
  const session = useOwnerSession();
  const policyQuery = useHostelPolicy(session.primaryHostelId);

  const draftCount = templates.filter((t) => t.status !== 'PUBLISHED').length;
  const sections = deriveAgreementSections({
    templateCount: templates.length,
    draftCount,
    rules,
    signatureConfigured,
    // Absent means required, matching the backend default.
    agreementRequired: policyQuery.data?.policy?.tenant_rules?.agreement_required !== false,
  });

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader
        backTo="/owner/more"
        backLabel="Configuration"
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

      {sections.map((section) => (
        <ConfigSectionGroup key={section.label} section={section} onNavigate={navigate} />
      ))}
    </div>
  );
}
