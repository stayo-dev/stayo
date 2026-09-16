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
    title: 'Unverified numbers are chased until they are confirmed',
    points: [
      'Onboarding asks the tenant to get their guardian to confirm, with one tap on WhatsApp.',
      'A tenant who cannot do it right then gets a week, and is reminded after that.',
      'Their record shows "Not verified" until the guardian confirms.',
    ],
  },
  off: {
    title: 'The number is recorded, and nobody is chased',
    points: [
      'Onboarding still asks, and a tenant can still confirm whenever they like.',
      'No deadline, no reminders, no prompts after onboarding.',
      'Their record shows "Not verified" as a plain fact, with no action attached.',
    ],
  },
};

/**
 * Configuration › Onboarding › Guardian verification — whether an unverified
 * parent/guardian number is chased or merely recorded (ADR-212).
 *
 * Writes `tenant_rules.guardian_verification`. Deliberately explicit about
 * what this does *not* control: neither setting blocks a tenant from
 * activating, and neither stops the number being collected. What an owner is
 * choosing here is whether Stayo keeps asking — which is a question about how
 * this hostel treats its residents, not a security setting.
 *
 * Mirrors `MoreConfigAgreementRequirementPage` down to the consequence list,
 * because the two settings answer the same kind of question and an owner
 * moving between them should meet one explanation, not two.
 */
export function MoreConfigGuardianVerificationPage() {
  const navigate = useNavigate();

  const hostelId = useConfiguredHostelId();
  const policyQuery = useHostelPolicy(hostelId);
  const updateMutation = useUpdateHostelPolicy(hostelId ?? '');

  const [chased, setChased] = useState(true);
  const [baseline, setBaseline] = useState<boolean | null>(null);

  useEffect(() => {
    const stored = policyQuery.data?.policy?.tenant_rules?.guardian_verification;
    if (policyQuery.data) {
      // Absent means chased, matching the backend default — a hostel that
      // predates this setting was having every guardian verified, so an absent
      // flag must not read as "stop asking".
      const loaded = String(stored ?? '').toUpperCase() !== 'OPTIONAL';
      setChased(loaded);
      setBaseline(loaded);
    }
  }, [policyQuery.data]);

  const dirty = hasChanges(baseline, chased);
  const consequence = CONSEQUENCES[chased ? 'on' : 'off'];

  const save = () => {
    if (!hostelId) return;
    updateMutation.mutate(
      { tenant_rules: { guardian_verification: chased ? 'MANDATORY' : 'OPTIONAL' } },
      {
        onSuccess: () => {
          stayoToast.success(
            chased ? 'Guardian numbers will be verified' : 'Guardian verification is now optional',
          );
          navigate('/owner/more/configuration');
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
        title="Guardian verification"
        subtitle="Whether an unconfirmed guardian number is chased"
      />

      <div className="flex flex-col gap-2">
        <span className={sectionLabel}>Requirement</span>
        <div className={`${card} px-4 pb-3.5 pt-3.5`}>
          <Toggle
            checked={chased}
            onChange={() => setChased((v) => !v)}
            label="Keep asking until it is verified"
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

      <p className="pl-0.5 text-[11px] leading-relaxed text-muted-foreground">
        Neither setting stops a tenant moving in. A guardian who cannot confirm today has never been a
        reason to turn someone away at the door, and this setting does not make it one.
      </p>

      <SaveBar
        visible={dirty}
        pending={updateMutation.isPending}
        onSave={save}
        onDiscard={() => baseline !== null && setChased(baseline)}
        label="Save requirement"
      />
    </div>
  );
}
