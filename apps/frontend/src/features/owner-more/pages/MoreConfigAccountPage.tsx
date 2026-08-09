import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useAuth } from '@context/AuthContext';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useHostelPolicy } from '@features/settings/settingsHooks';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { ConfigSectionGroup } from '../components/ConfigSectionGroup';
import { UNAVAILABLE_LABEL } from '../config/configRows';
import type { ConfigSection } from '../config/deriveConfigSections';
import { authApi } from '@lib/authApi';

/**
 * Configuration › Account & Security.
 *
 * Named "Account & Security", not "Account & Team": `Role` is only
 * OWNER/TENANT/ADMIN, so there is no team, no manager or staff role, and no
 * invitations. 2FA and backup codes have no schema either. Showing four
 * teammates and a 2FA switch would be inventing an access-control model the
 * backend cannot enforce — the most dangerous thing to fake on a security
 * screen.
 *
 * **Improvement on the design:** where the mockup has a dead "Active sessions ·
 * 3 devices" row, this offers the real action instead. Device listing does not
 * exist, but `POST /api/auth/logout-all` does — and now that Redis is
 * configured, its revocation deny-list is actually enforced on every request.
 * That is the thing an owner actually wants from that row.
 */
export function MoreConfigAccountPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const session = useOwnerSession();
  const policyQuery = useHostelPolicy(session.primaryHostelId);
  const [signingOutAll, setSigningOutAll] = useState(false);

  const hostel = policyQuery.data?.hostel;
  const gstSet = Boolean(hostel?.gst_number);

  const sections: ConfigSection[] = [
    {
      label: 'Profile',
      rows: [
        {
          key: 'owner-profile',
          title: 'Owner profile',
          detail: [user?.name, user?.email].filter(Boolean).join(' · ') || 'Not loaded',
          state: user?.name && user?.email ? 'configured' : 'attention',
          route: '/owner/more/profile',
        },
        {
          key: 'business-information',
          title: 'Business information',
          detail: hostel?.name
            ? `${hostel.name} · ${gstSet ? `GSTIN ${hostel.gst_number}` : 'GSTIN pending'}`
            : 'Not set',
          state: hostel?.name && gstSet ? 'configured' : 'attention',
          route: '/owner/more/hostel',
        },
      ],
    },
    {
      label: 'Team',
      rows: [
        {
          key: 'team-members',
          title: 'Team members',
          detail: `${UNAVAILABLE_LABEL} — Stayo has no staff or manager roles yet`,
          state: 'unavailable',
        },
      ],
    },
    {
      label: 'Security',
      rows: [
        {
          key: 'change-password',
          title: 'Change password',
          detail: 'Sets a new password for this account',
          state: 'configured',
          route: '/owner/more/settings',
        },
        {
          key: 'two-factor',
          title: 'Two-factor authentication',
          detail: `${UNAVAILABLE_LABEL} — no second-factor support exists yet`,
          state: 'unavailable',
        },
      ],
    },
  ];

  const signOutEverywhere = async () => {
    setSigningOutAll(true);
    try {
      await authApi.logoutAllDevices();
      stayoToast.success('Signed out on every device. Sign in again to continue.');
    } catch {
      stayoToast.error('Could not sign out other devices');
    } finally {
      setSigningOutAll(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader
        backTo="/owner/more/configuration"
        backLabel="Configuration"
        title="Account & Security"
        subtitle="Identity, access & sessions"
      />

      {sections.map((section) => (
        <ConfigSectionGroup key={section.label} section={section} onNavigate={navigate} />
      ))}

      <div className="flex flex-col gap-2.5">
        <div className="pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Sessions
        </div>
        <div className="rounded-[20px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="text-[13.5px] font-semibold text-foreground">Sign out everywhere</div>
          <p className="mt-1 text-[11.5px] leading-relaxed text-muted-foreground">
            Ends every session for this account, on every device, immediately — including this one.
            Use it if you signed in on a shared computer.
          </p>
          <button
            type="button"
            disabled={signingOutAll}
            onClick={signOutEverywhere}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-destructive/30 bg-destructive/8 py-3 text-[13px] font-semibold text-destructive disabled:opacity-60"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.9} />
            {signingOutAll ? 'Signing out…' : 'Sign out of all devices'}
          </button>
        </div>
      </div>
    </div>
  );
}
