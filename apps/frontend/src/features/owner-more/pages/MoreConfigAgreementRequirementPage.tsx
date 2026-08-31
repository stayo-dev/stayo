import { useConfiguredHostelId } from '../hooks/useConfiguredHostel';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useHostelPolicy, useUpdateHostelPolicy } from '@features/settings/settingsHooks';
import { Toggle } from '@features/owner-food/components/Toggle';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { SaveBar } from '../components/SaveBar';
import { hasChanges } from '../config/dirtyState';

const card =
  'overflow-hidden rounded-[16px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04)]';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

/** What changes for a tenant, stated per choice rather than in the abstract. */
const CONSEQUENCES: Record<'on' | 'off', { title: string; points: string[] }> = {
  on: {
    title: 'Tenants sign before they are activated',
    points: [
      'They accept your hostel rules, then sign the residency agreement.',
      'A signed copy is stored against their record, with your signature stamp.',
      'Activation is blocked until both steps are done.',
    ],
  },
  off: {
    title: 'Tenants are activated without signing',
    points: [
      'The rules and agreement steps are skipped during onboarding.',
      'Onboarding becomes account setup, then profile, then activation.',
      'Rent, dues, deposits and move-out settlement are unaffected.',
    ],
  },
};

/**
 * Configuration › Agreements › Tenant agreement — whether tenants must sign.
 *
 * Writes `tenant_rules.agreement_required`, which the activation state machine
 * reads to decide whether the RULES and AGREEMENT onboarding steps apply
 * (ADR-059). Deliberately explicit that this governs the *signing ceremony*
 * only: the `Agreement` record itself is the financial contract that rent
 * changes, obligations and settlement are keyed to, so it is still created.
 */
export function MoreConfigAgreementRequirementPage() {
  const navigate = useNavigate();
  
  const hostelId = useConfiguredHostelId();
  const policyQuery = useHostelPolicy(hostelId);
  const updateMutation = useUpdateHostelPolicy(hostelId ?? '');

  const [required, setRequired] = useState(true);
  const [baseline, setBaseline] = useState<boolean | null>(null);

  useEffect(() => {
    const stored = policyQuery.data?.policy?.tenant_rules?.agreement_required;
    if (policyQuery.data) {
      // Absent means required, matching the backend default.
      const loaded = stored !== false;
      setRequired(loaded);
      setBaseline(loaded);
    }
  }, [policyQuery.data]);

  const dirty = hasChanges(baseline, required);
  const consequence = CONSEQUENCES[required ? 'on' : 'off'];

  const save = () => {
    if (!hostelId) return;
    updateMutation.mutate(
      { tenant_rules: { agreement_required: required } },
      {
        onSuccess: () => {
          stayoToast.success(required ? 'Agreement is now required' : 'Agreement is no longer required');
          navigate('/owner/more/configuration/agreements');
        },
        onError: (error: any) =>
          stayoToast.error(error?.response?.data?.error?.message || 'Could not save this setting'),
      },
    );
  };

  if (policyQuery.isLoading) {
    return (
      <div className="flex flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="h-8 w-56 animate-pulse rounded-lg bg-muted" />
        <div className="h-28 animate-pulse rounded-2xl bg-muted" />
        <div className="h-40 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  return (
    <div className={`flex flex-col gap-5 px-4 pt-6 sm:px-6 ${dirty ? 'pb-40' : 'pb-24'}`}>
      <MoreScreenHeader
        title="Tenant agreement"
        subtitle="Whether tenants must sign before moving in"
      />

      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Requirement</span>
        <div className={`${card} px-4 pb-3.5 pt-3.5`}>
          <Toggle
            checked={required}
            onChange={() => setRequired((v) => !v)}
            label="Require a signed agreement"
            sub="Part of every tenant's onboarding"
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>What this means</span>
        <div className="rounded-xl border border-border bg-muted/40 px-3.5 py-3">
          <div className="font-display text-[12.5px] font-bold text-foreground">{consequence.title}</div>
          <ul className="mt-1.5 flex flex-col gap-1">
            {consequence.points.map((point) => (
              <li key={point} className="flex gap-2 text-[11.5px] leading-relaxed text-muted-foreground">
                <span aria-hidden className="mt-[7px] h-1 w-1 flex-none rounded-full bg-muted-foreground/60" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {!required && (
        <p className="pl-0.5 text-[11px] leading-relaxed text-muted-foreground">
          Tenants already onboarded keep the agreements they signed — turning this off changes what new
          tenants are asked to do, and nothing that has already happened.
        </p>
      )}

      <SaveBar
        visible={dirty}
        pending={updateMutation.isPending}
        onSave={save}
        onDiscard={() => baseline !== null && setRequired(baseline)}
        label="Save requirement"
      />
    </div>
  );
}
