import type { InviteWizardData } from '../../types';

interface TenantStepProps {
  data: InviteWizardData;
  setD: (patch: Partial<InviteWizardData>) => void;
}

const labelStyle = 'mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground';
const inputStyle = 'w-full rounded-[11px] border border-border bg-card px-3.5 py-3 text-sm font-semibold text-foreground focus:border-primary focus:outline-none';

/** Step 1/4 of the Invite Tenant wizard — who's moving in. */
export function TenantStep({ data, setD }: TenantStepProps) {
  return (
    <div className="flex flex-col gap-4.5">
      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
        Who&apos;s moving in? We&apos;ll text them an invite to complete KYC.
      </p>
      <label className="block">
        <span className={labelStyle}>Full name</span>
        <input value={data.tenantName} onChange={(e) => setD({ tenantName: e.target.value })} placeholder="Tenant's full name" className={inputStyle} />
      </label>
      <label className="block">
        <span className={labelStyle}>Phone</span>
        <div className="flex items-center rounded-[11px] border border-border bg-card px-3.5">
          <span className="text-sm font-semibold text-muted-foreground">+91</span>
          <input
            value={data.tenantPhone}
            onChange={(e) => setD({ tenantPhone: e.target.value })}
            placeholder="90000 00000"
            inputMode="tel"
            className="min-w-0 flex-1 bg-transparent px-2 py-3 text-sm font-semibold text-foreground focus:outline-none"
          />
        </div>
      </label>
    </div>
  );
}
