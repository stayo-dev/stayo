import { Check, ShieldCheck } from 'lucide-react';
import { C, FONT } from '@/app/pages/discover/discoverTheme';
import { buildHostByline, buildHostCard, type HostCardModel } from '../model/hostCardModel';
import type { PublicHost } from '../model/types';

/**
 * "Meet your host" — the "In their own words" card (ADR-200).
 *
 * A thin renderer over `buildHostCard`; every decision (which variant, which
 * stats, what the button says) is made and tested there. Used unchanged by
 * the Discover listing, the owner's own preview and the admin drawer — so
 * what an owner previews is what a resident sees.
 *
 * Discover's hard-coded palette, deliberately: this is a public-surface
 * component, and it should look identical inside the owner and admin shells
 * that preview it.
 */

const SERIF = "Georgia, 'Times New Roman', serif";

type PhotoFields = Pick<HostCardModel, 'photoUrl' | 'initial' | 'verified' | 'name'>;

function HostPhoto({ card, size }: { card: PhotoFields; size: number }) {
  const tick = Math.round(size * 0.36);
  return (
    <span className="relative flex-none" style={{ width: size, height: size }}>
      {card.photoUrl ? (
        <img
          src={card.photoUrl}
          alt={card.name ? `Photo of ${card.name}` : 'Photo of the host'}
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center rounded-full font-extrabold"
          style={{ fontFamily: FONT.display, background: C.clayPaleBg, color: C.clayDeep, fontSize: size * 0.36 }}
        >
          {card.initial}
        </span>
      )}
      {card.verified && (
        <span
          className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border-2 border-white"
          style={{ width: tick, height: tick, background: C.green }}
          title="ID verified by Stayo"
          aria-label="ID verified by Stayo"
          role="img"
        >
          <Check className="text-white" style={{ width: tick * 0.55, height: tick * 0.55 }} strokeWidth={3.5} />
        </span>
      )}
    </span>
  );
}

function Identity({ card }: { card: HostCardModel }) {
  return (
    <div className="min-w-0">
      <p className="text-[16.5px] font-extrabold leading-tight" style={{ fontFamily: FONT.display, color: C.text }}>
        {card.name ?? 'The owner'}
      </p>
      <p className="mt-0.5 text-[12px] leading-[1.45]" style={{ color: C.textMuted }}>{card.role}</p>
      {card.facts.map((fact) => (
        <p key={fact} className="mt-0.5 text-[11.5px] leading-[1.45]" style={{ color: C.textMuted }}>{fact}</p>
      ))}
    </div>
  );
}

export function HostCard({
  host,
  hostelName,
  onEnquire,
}: {
  host: PublicHost | null | undefined;
  hostelName?: string | null;
  /** Omit in previews: the button still renders, so the preview is faithful, but does nothing. */
  onEnquire?: () => void;
}) {
  const card = buildHostCard(host, { hostelName });
  if (!card) return null;

  if (card.variant === 'platform') {
    return (
      <div className="flex items-center gap-3">
        <HostPhoto card={card} size={44} />
        <div className="min-w-0">
          <p className="text-[13.5px] font-bold" style={{ fontFamily: FONT.display, color: C.text }}>{card.heading}</p>
          <p className="mt-0.5 text-[11.5px]" style={{ color: C.textMuted }}>{card.role}</p>
        </div>
      </div>
    );
  }

  return (
    <section aria-label={card.heading}>
      <h2 className="text-[16px] font-extrabold tracking-[-0.01em]" style={{ fontFamily: FONT.display, color: C.text }}>
        {card.heading}
      </h2>

      {card.variant === 'note' ? (
        <figure className="mt-3 rounded-[20px] border bg-white px-[18px] pb-[18px] pt-4" style={{ borderColor: C.line }}>
          <span aria-hidden className="block h-[26px] text-[54px] leading-[0.6]" style={{ fontFamily: SERIF, color: C.clay }}>
            “
          </span>
          <blockquote
            className="mt-1 whitespace-pre-line text-[15.5px] leading-[1.6]"
            style={{ fontFamily: SERIF, color: C.text }}
          >
            {card.bio}
          </blockquote>
          <figcaption className="mt-4 flex items-center gap-3 border-t pt-3.5" style={{ borderColor: C.line }}>
            <HostPhoto card={card} size={56} />
            <Identity card={card} />
          </figcaption>
        </figure>
      ) : (
        <div className="mt-3 flex items-center gap-3 rounded-[20px] border bg-white p-4" style={{ borderColor: C.line }}>
          <HostPhoto card={card} size={60} />
          <Identity card={card} />
        </div>
      )}

      {card.stats.length > 0 && (
        <dl className="mt-3.5 flex justify-between gap-3 px-1">
          {card.stats.map((stat) => (
            <div key={stat.key} className="flex min-w-0 flex-col-reverse">
              <dt className="text-[11px]" style={{ color: C.textMuted }}>{stat.label}</dt>
              <dd className="text-[16px] font-extrabold" style={{ fontFamily: FONT.display, color: C.text }}>{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {card.ctaLabel && (
        <button
          type="button"
          onClick={onEnquire}
          disabled={!onEnquire}
          className="mt-4 block w-full rounded-[14px] border-[1.5px] bg-white px-4 py-3 text-center text-[14px] font-bold disabled:cursor-default"
          style={{ borderColor: C.text, color: C.text, fontFamily: FONT.display }}
        >
          {card.ctaLabel}
        </button>
      )}

      <p className="mt-3 flex items-start gap-2 text-[11.5px] leading-[1.45]" style={{ color: C.textMuted }}>
        <ShieldCheck className="mt-px h-3.5 w-3.5 flex-none" strokeWidth={1.8} />
        Pay and talk through Stayo, so there's a record of everything.
      </p>
    </section>
  );
}

/**
 * The one-line "Hosted by …" row near the top of a listing (ADR-200, revised
 * 2026-09-15 to Airbnb's two-placement pattern).
 *
 * A reader meets the person before they reach the rent, but the bio, the
 * stats and the Enquire button wait for `HostCard` at the foot of the page —
 * so the beds and the price stay where a listing's readers expect them.
 */
export function HostByline({ host }: { host: PublicHost | null | undefined }) {
  const byline = buildHostByline(host);
  if (!byline) return null;

  return (
    <div className="flex items-center gap-3">
      <HostPhoto card={{ ...byline, name: byline.name }} size={40} />
      <div className="min-w-0">
        <p className="truncate text-[13.5px] font-bold" style={{ fontFamily: FONT.display, color: C.text }}>
          {byline.title}
        </p>
        <p className="mt-0.5 truncate text-[11.5px]" style={{ color: C.textMuted }}>{byline.line}</p>
      </div>
    </div>
  );
}
