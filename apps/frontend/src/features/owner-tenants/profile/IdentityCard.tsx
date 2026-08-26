import { BadgeCheck, ScrollText, UserRound } from 'lucide-react';
import type { RealTenantDetail } from '../hooks/useTenantDetail';

/**
 * Who the tenant is, and what they've signed.
 *
 * All of this arrives on the owner overview response and none of it was
 * rendered — an owner could not see a tenant's email, whether their phone was
 * verified, where they study or work, or whether they had accepted the house
 * rules, despite the backend computing every one of those.
 *
 * Rows render only when they have a value. A profile with nothing filled in
 * shows a short card, not a column of dashes.
 */

function Row({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex items-start justify-between gap-3 border-t border-border/60 px-4 py-2.5 first:border-t-0">
      <span className="flex-none text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="min-w-0 text-right font-display text-[12.5px] font-bold text-foreground">
        {value}
      </span>
    </div>
  );
}

export function IdentityCard({ tenant }: { tenant: RealTenantDetail }) {
  const { identity, compliance } = tenant;

  const isWorking = identity.profileType?.toUpperCase() === 'WORKING_PROFESSIONAL';

  // "B.Tech · CSE · Year 2" reads better than three separate rows of one word.
  const study = [identity.course, identity.branch, identity.yearOfStudy && `Year ${identity.yearOfStudy}`]
    .filter(Boolean)
    .join(' · ');
  const work = [identity.jobRole, identity.officeName].filter(Boolean).join(' · ');

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-hidden rounded-[18px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
        <div className="flex items-center gap-2 px-4 pb-1 pt-3.5">
          <UserRound className="h-4 w-4 text-primary" strokeWidth={1.8} />
          <span className="font-display text-[15px] font-bold text-foreground">Tenant details</span>
        </div>
        <div className="pt-1.5">
          <Row label="Email" value={identity.email} />
          <Row
            label="Phone"
            value={tenant.phone ? `${tenant.phone}${identity.phoneVerified ? ' · Verified' : ''}` : ''}
          />
          <Row label="Gender" value={identity.gender} />
          <Row label="Date of birth" value={identity.dateOfBirth} />
          {isWorking ? (
            <>
              <Row label="Work" value={work} />
            </>
          ) : (
            <>
              <Row label="College" value={identity.collegeName} />
              <Row label="Studying" value={study} />
              <Row label="Roll number" value={identity.rollNumber} />
            </>
          )}
          <Row label="Permanent address" value={identity.permanentAddress} />
        </div>
      </div>

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
