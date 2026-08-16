import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * Drawer chrome only — header, scrolling body, optional sticky footer.
 *
 * Each screen supplies its own body, so the drawer never needs to know about
 * every entity it can display. Its open/closed identity lives in the URL
 * (see drawerParam.ts), not here.
 */
export function AdminDrawer({
  title, subtitle, initials, tint = '#B46A55', radius = 'rounded-xl',
  onClose, footer, children,
}: {
  title: string;
  subtitle?: string;
  initials: string;
  tint?: string;
  radius?: string;
  onClose: () => void;
  footer?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[90] flex justify-end">
      <button
        type="button"
        aria-label="Close detail"
        onClick={onClose}
        className="absolute inset-0 animate-[adFade_.2s_ease] bg-[rgba(28,22,18,.44)]"
      />
      <div className="relative flex h-screen w-[580px] max-w-[94vw] animate-[adDrawer_.28s_cubic-bezier(.22,1,.36,1)] flex-col bg-[#F7F3EF] shadow-[-24px_0_60px_rgba(30,20,12,.24)]">
        <div className="flex flex-none items-center gap-3 border-b border-[#E9DFD3] bg-white px-6 py-5">
          <span
            className={`flex h-[46px] w-[46px] flex-none items-center justify-center ${radius} font-admin text-base font-bold text-white`}
            style={{ background: tint }}
          >
            {initials}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-admin text-[17px] font-extrabold tracking-[-0.02em] text-[#221E1A]">
              {title}
            </div>
            {subtitle ? <div className="truncate text-[12px] text-[#8A7F75]">{subtitle}</div> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px] bg-[#F2ECE5]"
          >
            <X className="h-3.5 w-3.5 text-[#7A6F63]" />
          </button>
        </div>

        <div className="flex-1 overflow-auto px-6 pb-6 pt-[22px]">{children}</div>

        {footer ? (
          <div className="flex-none border-t border-[#E9DFD3] bg-white px-6 py-3.5">{footer}</div>
        ) : null}
      </div>
    </div>
  );
}

/** A titled card section, the drawer's repeating unit throughout the design. */
export function DrawerSection({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#EFE6DA] bg-white">
      <div className="flex items-center justify-between border-b border-[#F2ECE5] px-[18px] py-[13px]">
        <span className="text-[11px] font-bold uppercase tracking-[.06em] text-[#A2978B]">{title}</span>
        {action}
      </div>
      {children}
    </div>
  );
}

/** The drawer's key/value row, used for contact, business and meta blocks. */
export function KeyValueRows({ rows }: { rows: { k: string; v: ReactNode }[] }) {
  return (
    <>
      {rows.map((row, index) => (
        <div
          key={row.k}
          className={`flex items-center justify-between gap-3 px-[18px] py-3 ${
            index > 0 ? 'border-t border-[#F2ECE5]' : ''
          }`}
        >
          <span className="text-[12.5px] font-medium text-[#8A7F75]">{row.k}</span>
          <span className="text-right text-[12.5px] font-semibold text-[#2A2521]">{row.v}</span>
        </div>
      ))}
    </>
  );
}
