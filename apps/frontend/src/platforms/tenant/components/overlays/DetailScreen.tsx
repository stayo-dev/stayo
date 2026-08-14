import { ChevronLeft } from 'lucide-react';
import type { DetailConfig } from './types';
import { TONE_COLOR } from './types';
import { Section, sectionLabel } from './Section';

interface DetailScreenProps {
  config: DetailConfig;
  onBack: () => void;
}

/** Full-screen, config-driven read-only drill-in — Room details, per-utility screens, roommate cards, facility screens, ticket detail, profile detail cards. One renderer for ~20 destinations, matching Stayo Tenant.dc.html's own DETAIL-map architecture. */
export function DetailScreen({ config, onBack }: DetailScreenProps) {
  const pillTone = config.pillTone ? TONE_COLOR[config.pillTone] : null;
  return (
    <div className="stayo-panel-slide-in fixed inset-0 z-[45] flex flex-col bg-background">
      <div className="flex flex-none items-center gap-3 border-b border-[#EEE4D8] px-[18px] pb-3 pt-14">
        <button type="button" onClick={onBack} className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px] border border-[#EFE6DA] bg-card">
          <ChevronLeft className="h-[18px] w-[18px] text-[#4A433C]" strokeWidth={2} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="font-display text-[18px] font-extrabold tracking-[-0.02em] text-foreground">{config.title}</div>
          <div className="text-[11.5px] font-medium text-[#8A7F75]">{config.sub}</div>
        </div>
        {config.headPill && pillTone && (
          <span className="flex-none rounded-full px-3 py-1.5 text-[11px] font-bold" style={{ background: pillTone.bg, color: pillTone.c }}>
            {config.headPill}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-auto px-[18px] pb-7 pt-4">
        <div className="flex flex-col gap-5">
          {config.sections.map((section, i) => (
            <div key={i} className="flex flex-col gap-2.5">
              {'title' in section && section.title && <span className={sectionLabel}>{section.title}</span>}
              <Section section={section} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
