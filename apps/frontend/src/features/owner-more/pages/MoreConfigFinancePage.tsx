import { useNavigate } from 'react-router-dom';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { ConfigStatCards } from '../components/ConfigStatCards';
import { ConfigSectionGroup } from '../components/ConfigSectionGroup';
import { useConfigModule } from '../hooks/useConfigModule';

/**
 * Configuration › Finance — how money moves through the business.
 *
 * A thin renderer over `deriveFinanceSections`. Two rows differ deliberately
 * from the mockup, because the data does not support it:
 *
 * - **Payment methods** is "Not available yet". The screen this replaces
 *   printed "UPI · Cash · Bank transfer" from a string literal; `payment_method`
 *   exists only on individual payment rows, never as configuration.
 * - **Advance payments** is "Not available yet" because it is the *same* stored
 *   value as Security deposit (the flat legacy `advance_*` preferences are the
 *   nested `billing.deposit` object). Two editable controls over one value
 *   would be worse than one.
 */
export function MoreConfigFinancePage() {
  const navigate = useNavigate();
  const { sections, configured, attention, isLoading } = useConfigModule('finance');

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader
        backTo="/owner/more/configuration"
        backLabel="Configuration"
        title="Finance"
        subtitle="How money moves through your business"
      />

      <ConfigStatCards configured={configured} attention={attention} isLoading={isLoading} />

      {sections.map((section) => (
        <ConfigSectionGroup key={section.label} section={section} onNavigate={navigate} />
      ))}
    </div>
  );
}
