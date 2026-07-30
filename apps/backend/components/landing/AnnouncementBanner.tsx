'use client';

import { Megaphone } from 'lucide-react';
import type { LandingAnnouncement } from '@lib/sanity/landingContent';

function scrollToHref(href: string) {
  if (!href.startsWith('#')) return;
  document.getElementById(href.slice(1))?.scrollIntoView({ behavior: 'smooth' });
}

export function AnnouncementBanner({ announcements }: { announcements?: LandingAnnouncement[] }) {
  const announcement = announcements?.[0];
  if (!announcement) return null;

  const cta = announcement.cta;
  const isAnchor = cta?.href?.startsWith('#');

  return (
    <section className="bg-[#1B2D5B] px-4 py-3 text-white">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Megaphone className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#FBB040]" />
          <div>
            <p className="font-semibold">{announcement.title}</p>
            {announcement.description && <p className="text-sm text-white/80">{announcement.description}</p>}
          </div>
        </div>
        {cta &&
          (isAnchor ? (
            <button
              type="button"
              onClick={() => scrollToHref(cta.href)}
              className="rounded-lg bg-[#F07B1D] px-4 py-2 text-sm font-semibold text-white"
            >
              {cta.label}
            </button>
          ) : (
            <a href={cta.href} className="rounded-lg bg-[#F07B1D] px-4 py-2 text-center text-sm font-semibold text-white">
              {cta.label}
            </a>
          ))}
      </div>
    </section>
  );
}
