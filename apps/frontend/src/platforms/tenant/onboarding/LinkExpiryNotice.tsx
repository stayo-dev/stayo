import { useEffect, useState } from 'react';
import { Clock, ShieldCheck } from 'lucide-react';
import { expiryNotice, type ExpiryTone } from './linkExpiry';

/**
 * Tells the tenant how long their activation link has left.
 *
 * Deliberately quiet. The link lasts seven days, and for six of those a ticking
 * clock would be pressure with no purpose — it reads as a sales countdown and
 * undercuts the welcome the rest of onboarding is building. So it states a date
 * calmly until the last day, escalates only when escalating is honest, and says
 * nothing at all when there is nothing to say.
 *
 * It re-renders on a timer **only** in the final hours (`notice.live`), so the
 * common case costs one render.
 */

const TONES: Record<ExpiryTone, { bg: string; border: string; text: string; icon: string }> = {
  held: { bg: 'rgba(31,157,87,.10)', border: 'rgba(31,157,87,.28)', text: '#1F7A52', icon: '#1F9D57' },
  calm: { bg: 'rgba(255,255,255,.55)', border: 'rgba(47,47,47,.12)', text: '#6E635A', icon: '#8A7F75' },
  soon: { bg: 'rgba(224,150,60,.12)', border: 'rgba(224,150,60,.32)', text: '#8A5A1E', icon: '#D08A2E' },
  urgent: { bg: 'rgba(208,71,58,.12)', border: 'rgba(208,71,58,.34)', text: '#A3372C', icon: '#D0473A' },
  expired: { bg: 'rgba(208,71,58,.14)', border: 'rgba(208,71,58,.38)', text: '#A3372C', icon: '#D0473A' },
};

export default function LinkExpiryNotice({
  expiresAt,
  held,
}: {
  expiresAt: string | null | undefined;
  held?: boolean;
}) {
  const [now, setNow] = useState(() => new Date());
  const notice = expiryNotice({ expiresAt, held, now });

  useEffect(() => {
    if (!notice.live) return;
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, [notice.live]);

  if (!notice.label) return null;

  const tone = TONES[notice.tone];
  const Icon = notice.tone === 'held' ? ShieldCheck : Clock;

  return (
    <div
      className="mt-2 flex items-center gap-2 rounded-xl px-3 py-2"
      style={{ background: tone.bg, border: `1px solid ${tone.border}` }}
      // Only announce when it actually matters; a calm date does not need to
      // interrupt a screen reader mid-form.
      role={notice.tone === 'urgent' || notice.tone === 'expired' ? 'status' : undefined}
    >
      <Icon className="h-3.5 w-3.5 flex-none" style={{ color: tone.icon }} />
      <span className="min-w-0 text-[11.5px] font-semibold leading-snug" style={{ color: tone.text }}>
        {notice.label}
      </span>
    </div>
  );
}
