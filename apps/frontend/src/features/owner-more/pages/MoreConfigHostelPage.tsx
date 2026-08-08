import { useNavigate } from 'react-router-dom';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { ConfigStatCards } from '../components/ConfigStatCards';
import { ConfigSectionGroup } from '../components/ConfigSectionGroup';
import { useConfigModule } from '../hooks/useConfigModule';

/**
 * Configuration › Hostel — the owner's physical property setup.
 *
 * A thin renderer: every row, its state and its sub-line come from
 * `deriveHostelSections`, and both stat-card numbers from `tallyConfigRows`.
 * Nothing here decides whether a setting counts as configured.
 *
 * Room types and Amenities render as "Not available yet" — there is no
 * room-type model and no amenities field — and neither affects the counts.
 */
export function MoreConfigHostelPage() {
  const navigate = useNavigate();
  const { sections, configured, attention, isLoading } = useConfigModule('hostel');

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader
        backTo="/owner/more/configuration"
        backLabel="Configuration"
        title="Hostel"
        subtitle="Your physical property setup"
      />

      <ConfigStatCards configured={configured} attention={attention} isLoading={isLoading} />

      {sections.map((section) => (
        <ConfigSectionGroup key={section.label} section={section} onNavigate={navigate} />
      ))}
    </div>
  );
}
