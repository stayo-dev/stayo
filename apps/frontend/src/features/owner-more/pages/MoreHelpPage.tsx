import { HelpCenter } from '@features/help-center/components/HelpCenter';
import { MoreScreenHeader } from '../components/MoreScreenHeader';

/**
 * More → Help.
 *
 * Previously a list of mock FAQs above two rows that both raised a "Coming
 * soon" toast — so an owner who hit a real bug had no way to tell anyone, and
 * `platform_support_tickets` had never received a single row. The endpoint had
 * been role-agnostic the whole time; only the button was missing.
 *
 * Now the same Help Centre the tenant side gets, with the owner's own
 * catalogue: listing review, payouts, invites, service requests.
 */
export function MoreHelpPage() {
  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader backTo="/owner/more" backLabel="More" title="Help & Support" />
      <HelpCenter audience="owner" backTo="/owner/more" backLabel="More" chrome="embedded" />
    </div>
  );
}
