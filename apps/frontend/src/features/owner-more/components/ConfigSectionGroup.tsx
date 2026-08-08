import { ConfigSettingRow } from './ConfigSettingRow';
import type { ConfigSection } from '../config/deriveConfigSections';

/**
 * An uppercase section label above a card of setting rows — the repeating unit
 * of every configuration module screen (Identity & brand, Property, Money in,
 * Penalties…). Sections come from the pure `derive*Sections` functions, so this
 * component decides nothing beyond layout.
 */
export function ConfigSectionGroup({
  section,
  onNavigate,
}: {
  section: ConfigSection;
  onNavigate: (route: string) => void;
}) {
  if (section.rows.length === 0) return null;

  return (
    <div className="flex flex-col gap-2.5">
      <div className="pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {section.label}
      </div>
      <div className="overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
        {section.rows.map((row, index) => (
          <ConfigSettingRow
            key={row.key}
            row={row}
            onNavigate={onNavigate}
            className={index === 0 ? '' : 'border-t border-border/60'}
          />
        ))}
      </div>
    </div>
  );
}
