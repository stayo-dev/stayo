import { useEffect } from 'react';
import { useIsDesktop } from '@/app/components/ui/use-desktop';
import { HelpCenter } from '@features/help-center/components/HelpCenter';

/**
 * Profile → Help (ADR-079, rebuilt).
 *
 * The Stayo-side inbox: problems with the app, an account or a payment, going
 * to Stayo admin. Deliberately separate from `/tenant/complaints`
 * (tenant → hostel) — but no longer silent about it. The old page opened
 * straight into a form and never mentioned the other channel, so someone with
 * a broken geyser had nothing here to stop them filing it with us.
 */
export function SupportTicketsPage() {
  // Desktop (lg+, ADR-171 Phase 3.5): `HelpCenter` already has a `chrome`
  // prop for exactly this — `embedded` suppresses its own header for a host
  // that already supplies one (the console topbar), same as Owner's
  // `MoreHelpPage` does today. `HelpCenter`'s own ticket/FAQ/report behavior
  // is untouched either way.
  const isDesktop = useIsDesktop();
  useEffect(() => {
    document.title = 'Help — Stayo';
  }, []);

  if (isDesktop) {
    return (
      <div className="mx-auto w-full max-w-[640px] px-8 pb-8 pt-8">
        <HelpCenter audience="tenant" chrome="embedded" />
      </div>
    );
  }

  return <HelpCenter audience="tenant" backTo="/profile" backLabel="Profile" />;
}
