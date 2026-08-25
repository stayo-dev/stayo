import { useEffect } from 'react';
import { Copy, Check, Mail, MessageCircle, MessageSquare, Send, Share2, X } from 'lucide-react';
import { buildShareLinks, type ShareChannel, type ShareTarget } from '@shared/lib/shareListing';

/**
 * "Share this place" — a preview of what you're sending, then where to send it.
 *
 * ## Why this exists when `navigator.share` already did
 *
 * The OS sheet is genuinely better *on a phone*: it reaches Instagram, it knows
 * which chat apps are installed, and it lists recent contacts. Replacing it
 * would have been a downgrade.
 *
 * But it does not exist on desktop, where sharing silently copied a link and
 * showed a toast — no preview, no targets, no sense of what the other person
 * would receive. That is the gap this fills.
 *
 * So the OS sheet is kept as a first-class row ("More options") wherever it
 * exists, rather than replaced. On a phone you get the preview *and* Instagram;
 * on a laptop you get the targets you previously had none of.
 */

const ICONS: Record<ShareChannel, typeof Mail> = {
  whatsapp: MessageCircle,
  telegram: Send,
  email: Mail,
  sms: MessageSquare,
  facebook: Share2,
  x: X,
};

export interface ShareSheetProps {
  open: boolean;
  onClose: () => void;
  hostel: ShareTarget;
  /** The `/h/<slug>` link — built by the caller from `window.location.origin`. */
  url: string;
  /** Photo of the hostel, for the preview card. */
  photoUrl?: string | null;
  /** "Boys hostel in Hyderabad · from ₹8,000/mo". */
  summary?: string;
  /** True once the link has just been copied, so the row can confirm it. */
  copied?: boolean;
  onCopy: () => void;
  /** Present only where `navigator.share` exists. */
  onNativeShare?: (() => void) | null;
}

export default function ShareSheet({
  open,
  onClose,
  hostel,
  url,
  photoUrl,
  summary,
  copied,
  onCopy,
  onNativeShare,
}: ShareSheetProps) {
  // Escape closes, and the page behind must not scroll under the sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  const links = buildShareLinks(hostel, url);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center"
      style={{ background: 'rgba(20,16,13,.5)' }}
      role="presentation"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Share this place"
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[520px] rounded-t-[22px] bg-white sm:rounded-[22px]"
        style={{ padding: '18px 18px calc(18px + env(safe-area-inset-bottom))' }}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-[19px] font-extrabold tracking-tight text-[#221E1A]">Share this place</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-mr-1 -mt-1 flex h-8 w-8 flex-none items-center justify-center rounded-full text-[#5A5147] hover:bg-black/[.05]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* What the other person will see. The preview is the point: it is the
            difference between "a link was copied" and "I know what I sent". */}
        <div className="mt-3.5 flex items-center gap-3">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt=""
              className="h-[52px] w-[52px] flex-none rounded-xl object-cover"
              loading="lazy"
            />
          ) : (
            <div className="h-[52px] w-[52px] flex-none rounded-xl bg-[#EFE9E2]" />
          )}
          <div className="min-w-0">
            <div className="truncate text-[13.5px] font-bold text-[#221E1A]">{hostel.name}</div>
            {summary && <div className="mt-0.5 truncate text-[12px] text-[#7A6F63]">{summary}</div>}
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={onCopy}
            className="flex items-center justify-between gap-3 rounded-xl border border-[#E7DDD1] px-3.5 py-3 text-left text-[13.5px] font-semibold text-[#221E1A] transition-colors hover:bg-[#F7F3EF]"
          >
            {copied ? 'Link copied' : 'Copy link'}
            {copied ? (
              <Check className="h-4 w-4 flex-none text-[#1F9D57]" strokeWidth={2.6} />
            ) : (
              <Copy className="h-4 w-4 flex-none text-[#5A5147]" />
            )}
          </button>

          {links.map((link) => {
            const Icon = ICONS[link.channel];
            return (
              <a
                key={link.channel}
                href={link.href}
                {...(link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                onClick={() => onClose()}
                className="flex items-center justify-between gap-3 rounded-xl border border-[#E7DDD1] px-3.5 py-3 text-[13.5px] font-semibold text-[#221E1A] transition-colors hover:bg-[#F7F3EF]"
              >
                {link.label}
                <Icon className="h-4 w-4 flex-none text-[#5A5147]" />
              </a>
            );
          })}

          {/* Kept, not replaced: this is the only route to Instagram and to the
              person's actual recent contacts. */}
          {onNativeShare && (
            <button
              type="button"
              onClick={() => {
                onClose();
                onNativeShare();
              }}
              className="flex items-center justify-between gap-3 rounded-xl border border-[#E7DDD1] px-3.5 py-3 text-left text-[13.5px] font-semibold text-[#221E1A] transition-colors hover:bg-[#F7F3EF]"
            >
              More options
              <Share2 className="h-4 w-4 flex-none text-[#5A5147]" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
