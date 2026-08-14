import { Inbox } from 'lucide-react';
import type { DetailSection } from './types';
import { TONE_COLOR } from './types';

export const sectionLabel = 'text-[12px] font-bold uppercase tracking-[0.06em] text-[#9C9186]';
export const card = 'rounded-[16px] border border-[#EFE6DA] bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_4px_14px_rgba(40,30,20,0.05)]';

/** Renders one `DetailSection` — shared by `DetailScreen` (read-only drill-ins) and `ProfileEditScreen`'s view mode, so both use the exact same card/row visual language from Stayo Tenant.dc.html. */
export function Section({ section }: { section: DetailSection }) {
  switch (section.kind) {
    case 'status':
      return (
        <div className={`${card} flex items-center gap-3.5 p-4`}>
          <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-xl bg-[#F5E9E3] text-primary">
            {section.icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="font-display text-[19px] font-extrabold tracking-[-0.01em]" style={{ color: TONE_COLOR[section.tone].c }}>
              {section.big}
            </div>
            <div className="mt-0.5 text-[12px] font-medium text-[#8A7F75]">{section.sub}</div>
          </div>
          <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: TONE_COLOR[section.tone].c }} />
        </div>
      );
    case 'chips':
      return (
        <div className={`${card} grid grid-cols-2 overflow-hidden`}>
          {section.chips.map((c, i) => (
            <div
              key={c.k}
              style={{
                padding: '13px 15px',
                borderTop: i >= 2 ? '1px solid #F2ECE5' : 'none',
                borderLeft: i % 2 === 1 ? '1px solid #F2ECE5' : 'none',
              }}
            >
              <div className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-[#A2978B]">{c.k}</div>
              <div className="mt-0.5 font-display text-[13.5px] font-bold text-foreground">{c.v}</div>
            </div>
          ))}
        </div>
      );
    case 'rows':
      return (
        <div className={`${card} divide-y divide-[#F2ECE5] px-4`}>
          {section.rows.map((r) => (
            <div key={r.label} className="flex items-center justify-between gap-3.5 py-[13px]">
              <span className="flex-none text-[12.5px] font-medium text-[#8A7F75]">{r.label}</span>
              <span
                className={`text-right text-foreground ${r.mono ? 'font-mono text-[13px] font-semibold' : 'font-display text-[13px] font-bold'}`}
              >
                {r.value}
              </span>
            </div>
          ))}
        </div>
      );
    case 'timeline':
      return (
        <div className={`${card} flex flex-col gap-3.5 px-4 pb-1 pt-[18px]`}>
          {section.steps.map((step, i) => {
            const last = i === section.steps.length - 1;
            const dotBg = step.state === 'done' ? '#1F7A52' : step.state === 'active' ? '#C2591F' : '#F0EAE2';
            const dotBorder = step.state === 'todo' ? '2px solid #E0D6CA' : 'none';
            return (
              <div key={step.label} className="flex gap-3.5">
                <div className="flex flex-none flex-col items-center">
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full text-white"
                    style={{ background: dotBg, border: dotBorder }}
                  >
                    {step.state === 'done' && (
                      <svg width="11" height="11" viewBox="0 0 11 11"><path d="M2 5.6 L4.4 8 L9 3" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" /></svg>
                    )}
                    {step.state === 'active' && <span className="h-2 w-2 rounded-full bg-white" />}
                  </span>
                  {!last && <span className="mt-0 min-h-[26px] w-0.5 flex-1" style={{ background: step.state === 'done' ? '#BFE0CD' : '#EAE1D8' }} />}
                </div>
                <div className={last ? 'pb-0.5' : 'pb-[18px]'}>
                  <div className="font-display text-[13.5px] font-bold tracking-[-0.01em]" style={{ color: step.state === 'todo' ? '#8A7F75' : '#221E1A' }}>
                    {step.label}
                  </div>
                  <div className="mt-0.5 text-[11.5px] font-medium text-[#9A8F84]">{step.meta}</div>
                </div>
              </div>
            );
          })}
        </div>
      );
    case 'notices':
      return (
        <div className="flex flex-col gap-2.5">
          {section.notices.map((n, i) => (
            <div key={i} className={`${card} flex gap-2.5 p-[13px_14px]`}>
              <span className="mt-1 h-2 w-2 flex-none rounded-full" style={{ background: TONE_COLOR[n.tone].c }} />
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-[#2A2521]">{n.title}</div>
                <div className="mt-0.5 text-[11.5px] font-medium text-[#9A8F84]">{n.meta}</div>
              </div>
            </div>
          ))}
        </div>
      );
    case 'photos':
      return (
        <div className="flex gap-2.5">
          {Array.from({ length: section.count }).map((_, i) => (
            <div key={i} className="flex flex-1 items-center justify-center rounded-xl border border-[#EFE6DA] bg-[#F0E8DE] text-[#B0A597]" style={{ aspectRatio: '4/3' }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6}>
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <circle cx="8.5" cy="10" r="1.5" />
                <path d="M21 16l-5-5-9 8" />
              </svg>
            </div>
          ))}
        </div>
      );
    case 'person':
      return (
        <div className={`${card} flex flex-col items-center gap-0 p-[22px_18px] text-center`}>
          <span className="flex h-[78px] w-[78px] items-center justify-center rounded-full bg-[#F5E9E3] font-display text-[30px] font-extrabold text-primary">
            {section.initial}
          </span>
          <div className="mt-[13px] font-display text-[19px] font-extrabold tracking-[-0.01em] text-foreground">{section.name}</div>
          <div className="mt-0.5 text-[12.5px] font-medium text-[#8A7F75]">{section.role}</div>
          <div className="mt-3.5 flex gap-2">
            <span className="rounded-full bg-[#F5EFE8] px-[13px] py-1.5 text-[11.5px] font-semibold text-[#6E6459]">{section.tag1}</span>
            <span className="rounded-full bg-[#F5EFE8] px-[13px] py-1.5 text-[11.5px] font-semibold text-[#6E6459]">{section.tag2}</span>
          </div>
        </div>
      );
    case 'empty':
      return (
        <div className="rounded-2xl border-[1.5px] border-dashed border-[#E0D6CA] bg-card p-[26px_18px] text-center">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-[#F5EFE8] text-[#B0A597]">
            <Inbox className="h-[22px] w-[22px]" strokeWidth={1.8} />
          </span>
          <div className="mt-3 font-display text-[15px] font-bold text-foreground">{section.title}</div>
          <div className="mt-1 text-[12px] leading-relaxed text-[#8A7F75]">{section.body}</div>
        </div>
      );
    case 'actions':
      return (
        <div className="flex flex-col gap-2.5">
          {section.actions.map((a) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              className={`rounded-[13px] py-[14px] text-center font-display text-sm font-bold ${
                a.style === 'primary'
                  ? 'bg-[#A45D44] text-white'
                  : a.style === 'dark'
                    ? 'bg-foreground text-background'
                    : 'border border-[#E4DACE] bg-card text-[#4A433C]'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      );
  }
}
