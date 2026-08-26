import { useEffect } from 'react';
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
  useEffect(() => {
    document.title = 'Help — Stayo';
  }, []);

  return <HelpCenter audience="tenant" backTo="/profile" backLabel="Profile" />;
}
