import { BadgeCheck, ScrollText } from 'lucide-react';
import type { RealTenantDetail } from '../hooks/useTenantDetail';

/**
 * What the tenant has and hasn't discharged during onboarding.
 *
 * Deliberately *not* a profile card. An earlier version of this file also
 * listed email, phone, gender, date of birth and address — which the owner
 * does not need on a tab about the stay, and which already appear where they
 * are actually useful: the contact details in the Communication Center, and
 * the identity documents under Documents. Removed on request.
 *
 * What is left is state the owner acts on: whether the profile is complete,
 * whether KYC passed, and whether the house rules were accepted and at which
 * version. The Risk & Compliance card at the top of the page shows the first
 * two as tiles; this adds the rules acceptance and its version, which nothing
 * else surfaces.
 */

export function ComplianceCard({ tenant }: { tenant: RealTenantDetail }) {
  const { compliance } = tenant;

  return (
    <div className="flex flex-col gap-2.5 rounded-[18px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <div className="flex items-center gap-2">
        <ScrollText className="h-4 w-4 text-primary" strokeWidth={1.8} />
        <span className="font-display text-[15px] font-bold text-foreground">Compliance</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        <ComplianceRow done={compliance.profileCompleted} label="Profile completed" />
        <ComplianceRow done={compliance.documentVerified} label="KYC documents verified" />
        <ComplianceRow
          done={compliance.rulesAccepted}
          label={
            compliance.rulesAccepted
              ? `House rules accepted${compliance.rulesVersion ? ` (v${compliance.rulesVersion})` : ''}${
                  compliance.rulesAcceptedAt ? ` · ${compliance.rulesAcceptedAt}` : ''
                }`
              : 'House rules not accepted yet'
          }
        />
      </ul>
    </div>
  );
}

function ComplianceRow({ done, label }: { done: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2">
      <BadgeCheck
        className={`h-4 w-4 flex-none ${done ? 'text-success' : 'text-muted-foreground/50'}`}
        strokeWidth={1.9}
      />
      <span className={`text-[12px] ${done ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
        {label}
      </span>
    </li>
  );
}
