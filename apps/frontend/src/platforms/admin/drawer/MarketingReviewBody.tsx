import { useEffect, useState } from 'react';
import { Flag, AlertTriangle, ExternalLink, X, ChevronLeft, ChevronRight, GitCompare, Maximize2 } from 'lucide-react';
import { useMarketingSubmission } from '@features/hostel-marketing/hooks/useMarketing';
import { DrawerSection, KeyValueRows } from './AdminDrawer';
import { diffMarketingContent, type ContentDiff } from './marketingDiff';

export const REVIEW_SECTIONS = ['basics', 'photos', 'beds', 'amenities', 'places', 'mess'] as const;
export type ReviewSection = (typeof REVIEW_SECTIONS)[number];

export const SECTION_LABEL: Record<ReviewSection, string> = {
  basics: 'Name, tagline & about',
  photos: 'Photos',
  beds: 'Rooms & pricing',
  amenities: 'Amenities',
  places: 'Getting around',
  mess: 'Mess menu',
};

export type SectionFlagDraft = { section: ReviewSection; note: string };

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/**
 * The whole submitted marketing page, section by section, each one flaggable.
 *
 * The reviewer's job is to judge content they cannot see anywhere else, so
 * every field the owner filled in is shown — not a summary. Bed tiers are
 * shown beside real room inventory where it exists, because the advertised
 * price and the operating price are the one thing an eyeball cannot check.
 */
export function MarketingReviewBody({
  revisionId, flags, onToggleFlag, onFlagNote,
}: {
  revisionId: string;
  flags: SectionFlagDraft[];
  onToggleFlag: (section: ReviewSection) => void;
  onFlagNote: (section: ReviewSection, note: string) => void;
}) {
  const submission = useMarketingSubmission(revisionId);
  const [lightbox, setLightbox] = useState<number | null>(null);

  if (submission.isLoading) {
    return <div className="py-12 text-center text-[13px] text-[#8A7F75]">Loading submission…</div>;
  }
  if (submission.isError || !submission.data) {
    return <div className="py-12 text-center text-[13px] text-[#B3402F]">Couldn't load this submission.</div>;
  }

  const s: any = submission.data;
  const c = s.content ?? {};
  const platformListed = String(s.hostel?.listing_source) === 'PLATFORM_LISTED';

  const photos: any[] = c.photos ?? [];

  /**
   * What the owner actually changed. The endpoint has always returned the
   * live revision alongside the submitted one ("so the reviewer sees the
   * change") and nothing rendered it — so a reviewer had to re-read a whole
   * listing to find a one-word edit.
   */
  const diff: ContentDiff = diffMarketingContent(s.live?.content ?? null, c);

  return (
    <div className="flex flex-col gap-4">
      {lightbox !== null && photos[lightbox] && (
        <PhotoLightbox
          photos={photos}
          index={lightbox}
          onClose={() => setLightbox(null)}
          onIndex={setLightbox}
        />
      )}

      {/* automated advisories — never block approval (ADR-076) */}
      {(s.flags ?? []).length > 0 && (
        <div className="rounded-2xl border border-[#F0DFC4] bg-[#FBF1DE] px-4 py-3.5">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.06em] text-[#B8792B]">
            <AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
            Worth checking
          </div>
          <div className="mt-1.5 flex flex-col gap-1">
            {(s.flags ?? []).map((f: any) => (
              <div key={f.code} className="text-[12px] leading-relaxed text-[#6E5B4E]">{f.message}</div>
            ))}
          </div>
          <div className="mt-2 text-[10.5px] text-[#A2978B]">
            Advisory only — an owner may legitimately run an introductory rate.
          </div>
        </div>
      )}

      {platformListed && (
        <div className="rounded-2xl border border-[#E6DCD1] bg-[#F2ECE5] px-4 py-3.5">
          <div className="text-[11px] font-bold uppercase tracking-[.06em] text-[#5A5147]">
            Stayo-listed hostel
          </div>
          <div className="mt-1 text-[12px] leading-relaxed text-[#5A5147]">
            Nobody operates this hostel in Stayo, so it has no real rooms. Its bed tiers are an
            advertised claim and the listing will not show live vacancy.
          </div>
        </div>
      )}

      {/* ── What changed ─────────────────────────────────────────────── */}
      {diff.isFirstSubmission ? (
        <div className="rounded-2xl border border-[#E6DCD1] bg-[#F7F3EF] px-4 py-3">
          <div className="text-[11px] font-bold uppercase tracking-[.06em] text-[#5A5147]">
            First submission
          </div>
          <div className="mt-1 text-[12px] leading-relaxed text-[#6E5B4E]">
            Nothing is live for this hostel yet, so every section below is new.
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-[#E6DCD1] bg-white px-4 py-3.5">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.06em] text-[#5A5147]">
            <GitCompare className="h-3.5 w-3.5" strokeWidth={2} />
            Changed since v{s.live?.version} {diff.changeCount > 0 && `· ${diff.changeCount}`}
          </div>

          {diff.changeCount === 0 ? (
            <div className="mt-1.5 text-[12px] leading-relaxed text-[#6E5B4E]">
              Nothing differs from the live version. Re-submitted without an edit, or the change is
              in a field this comparison does not cover — read the sections below before approving.
            </div>
          ) : (
            <div className="mt-2.5 flex flex-col gap-3">
              {diff.sections.map((section) => (
                <div key={section.section}>
                  <div className="text-[11px] font-bold text-[#221E1A]">{section.label}</div>
                  <div className="mt-1 flex flex-col gap-1">
                    {section.lines.map((line, index) => (
                      <div key={`${line.label}-${index}`} className="text-[12px] leading-relaxed text-[#6E5B4E]">
                        <span className="text-[#8A7F75]">{line.label}</span>
                        {line.before != null && (
                          <>
                            {' '}
                            <span className="text-[#B3402F] line-through decoration-[#D8B3AB]">{line.before}</span>
                          </>
                        )}
                        {line.after != null && (
                          <>
                            {line.before != null ? ' → ' : ' '}
                            <span className="font-semibold text-[#1F7A52]">{line.after}</span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <a
        href={`/admin/listings/preview/${revisionId}`}
        target="_blank"
        rel="noreferrer"
        className="flex items-center justify-center gap-2 rounded-xl bg-[#221E1A] py-3 font-admin text-[13px] font-bold text-white"
      >
        <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
        Preview on Discovery
      </a>

      <Section id="basics" flags={flags} onToggleFlag={onToggleFlag} onFlagNote={onFlagNote}>
        <KeyValueRows
          rows={[
            { k: 'Hostel', v: s.hostel?.name ?? '—' },
            { k: 'Tagline', v: c.basics?.tagline || <Missing /> },
            { k: 'City', v: s.hostel?.city ?? '—' },
            { k: 'Address', v: s.hostel?.address ?? '—' },
          ]}
        />
        <div className="border-t border-[#F2ECE5] px-[18px] py-3">
          <div className="text-[11px] font-semibold text-[#8A7F75]">About</div>
          <div className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#4A433C]">
            {c.basics?.about || <Missing />}
          </div>
        </div>
        {(c.basics?.highlights ?? []).length > 0 && (
          <div className="border-t border-[#F2ECE5] px-[18px] py-3">
            <div className="mb-1.5 text-[11px] font-semibold text-[#8A7F75]">Highlights</div>
            <div className="flex flex-wrap gap-1.5">
              {c.basics.highlights.map((h: string) => (
                <span key={h} className="rounded-lg bg-[#F5EFE8] px-2.5 py-1 text-[11.5px] text-[#6E6459]">{h}</span>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section id="photos" count={(c.photos ?? []).length} flags={flags} onToggleFlag={onToggleFlag} onFlagNote={onFlagNote}>
        {(c.photos ?? []).length === 0 ? (
          <div className="px-[18px] py-4"><Missing>No photos submitted</Missing></div>
        ) : (
          <div className="grid grid-cols-3 gap-2 p-[18px]">
            {c.photos.map((p: any, i: number) => (
              <button
                key={i}
                type="button"
                onClick={() => setLightbox(i)}
                title="Open full size"
                className="group relative block overflow-hidden rounded-[10px] border border-[#EFE6DA]"
              >
                <img
                  src={p.url}
                  alt={p.caption || `Photo ${i + 1}`}
                  className="h-20 w-full object-cover transition group-hover:scale-[1.04]"
                />
                <span className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100">
                  <Maximize2 className="h-4 w-4 text-white" strokeWidth={2.2} />
                </span>
              </button>
            ))}
          </div>
        )}
      </Section>

      <Section id="beds" count={(c.beds ?? []).length} flags={flags} onToggleFlag={onToggleFlag} onFlagNote={onFlagNote}>
        {(c.beds ?? []).length === 0 ? (
          <div className="px-[18px] py-4"><Missing>No bed tiers</Missing></div>
        ) : (
          c.beds.map((b: any, i: number) => (
            <div key={i} className={`flex items-center gap-3 px-[18px] py-3 ${i > 0 ? 'border-t border-[#F2ECE5]' : ''}`}>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-[#2A2521]">{b.sharing ?? '—'}</div>
                <div className="text-[11px] text-[#9A8F84]">
                  deposit {b.deposit != null ? `₹${Number(b.deposit).toLocaleString('en-IN')}` : '—'}
                  {b.availability ? ` · ${b.availability}` : ''}
                </div>
              </div>
              <div className="font-admin text-[15px] font-extrabold text-[#221E1A]">
                {b.price != null ? `₹${Number(b.price).toLocaleString('en-IN')}` : '—'}
                <span className="text-[10px] font-medium text-[#9A8F84]">/mo</span>
              </div>
            </div>
          ))
        )}
      </Section>

      <Section id="amenities" count={(c.amenities ?? []).filter((a: any) => a.enabled).length} flags={flags} onToggleFlag={onToggleFlag} onFlagNote={onFlagNote}>
        <div className="flex flex-wrap gap-1.5 p-[18px]">
          {(c.amenities ?? []).filter((a: any) => a.enabled).length === 0 ? (
            <Missing>None enabled</Missing>
          ) : (
            c.amenities.filter((a: any) => a.enabled).map((a: any) => (
              <span key={a.key} className="rounded-lg bg-[#F5EFE8] px-2.5 py-1.5 text-[11.5px] font-semibold text-[#6E6459]">
                {a.label ?? a.key}
              </span>
            ))
          )}
        </div>
      </Section>

      <Section id="places" count={(c.places ?? []).length} flags={flags} onToggleFlag={onToggleFlag} onFlagNote={onFlagNote}>
        {(c.places ?? []).length === 0 ? (
          <div className="px-[18px] py-4"><Missing>Nothing added</Missing></div>
        ) : (
          <KeyValueRows
            rows={c.places.map((p: any) => ({
              k: p.name ?? '—',
              v: p.distance_km != null ? `${p.distance_km} km` : '—',
            }))}
          />
        )}
      </Section>

      <Section id="mess" flags={flags} onToggleFlag={onToggleFlag} onFlagNote={onFlagNote}>
        {!c.mess?.provided ? (
          <div className="px-[18px] py-4 text-[12px] text-[#8A7F75]">
            This hostel does not serve meals — the section will be hidden on Discovery.
          </div>
        ) : (
          <div className="p-[18px]">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {(c.mess.meals ?? []).map((m: any) => (
                <span
                  key={m.key}
                  className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
                    m.enabled ? 'bg-[#EAF3EE] text-[#1F7A52]' : 'bg-[#F2ECE5] text-[#A2978B] line-through'
                  }`}
                >
                  {m.label ?? m.key}
                </span>
              ))}
            </div>
            <div className="overflow-x-auto">
              <div className="min-w-[420px]">
                {(c.mess.week ?? []).map((day: any, i: number) => (
                  <div key={i} className={`flex gap-3 py-2 ${i > 0 ? 'border-t border-[#F2ECE5]' : ''}`}>
                    <span className="w-9 flex-none text-[11px] font-bold text-[#A2978B]">{DAYS[i] ?? i + 1}</span>
                    <span className="min-w-0 flex-1 text-[12px] text-[#4A433C]">
                      {(day?.meals ?? [])
                        .map((m: any) => (Array.isArray(m?.dishes) ? m.dishes.join(', ') : ''))
                        .filter(Boolean)
                        .join(' · ') || <Missing>Empty</Missing>}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Section>
    </div>
  );
}

function Missing({ children = 'Not provided' }: { children?: React.ReactNode }) {
  return <span className="text-[12px] italic text-[#B0A597]">{children}</span>;
}

function Section({
  id, count, children, flags, onToggleFlag, onFlagNote,
}: {
  id: ReviewSection;
  count?: number;
  children: React.ReactNode;
  flags: SectionFlagDraft[];
  onToggleFlag: (s: ReviewSection) => void;
  onFlagNote: (s: ReviewSection, note: string) => void;
}) {
  const flag = flags.find((f) => f.section === id);
  const [open, setOpen] = useState(true);

  return (
    <div className={`overflow-hidden rounded-2xl border bg-white ${flag ? 'border-[#E6C7BF]' : 'border-[#EFE6DA]'}`}>
      <div className={`flex items-center justify-between border-b px-[18px] py-[13px] ${flag ? 'border-[#EFD6CE] bg-[#FBEFE9]' : 'border-[#F2ECE5]'}`}>
        <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-left">
          <span className="text-[11px] font-bold uppercase tracking-[.06em] text-[#A2978B]">
            {SECTION_LABEL[id]}
          </span>
          {count != null && (
            <span className="rounded-full bg-[#F2ECE5] px-1.5 py-0.5 font-admin text-[10px] font-bold text-[#8A7F75]">
              {count}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => onToggleFlag(id)}
          title={flag ? 'Remove flag' : 'Flag this section for changes'}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold ${
            flag ? 'bg-[#B3402F] text-white' : 'bg-[#F2ECE5] text-[#8A7F75] hover:text-[#B3402F]'
          }`}
        >
          <Flag className="h-3 w-3" strokeWidth={2.4} />
          {flag ? 'Flagged' : 'Flag'}
        </button>
      </div>

      {open && children}

      {flag && (
        <div className="border-t border-[#EFD6CE] bg-[#FBEFE9] px-[18px] py-3">
          <input
            value={flag.note}
            onChange={(e) => onFlagNote(id, e.target.value)}
            placeholder="What needs changing here? (the owner sees this)"
            className="w-full rounded-[10px] border border-[#E6C7BF] bg-white px-3 py-2.5 text-[12.5px] text-[#2A2521] outline-none"
          />
        </div>
      )}
    </div>
  );
}


/**
 * Full-screen photo viewer for review.
 *
 * A plain link to the photo does not work: owner photos arrive as `data:`
 * URIs, and browsers refuse to navigate a top-level tab to one — clicking did
 * nothing at all. Reviewing a listing means actually looking at the pictures,
 * so this renders them at full size with keyboard paging.
 *
 * Rendered above the drawer (z-[100]) because the drawer itself is z-[90].
 */
function PhotoLightbox({
  photos, index, onClose, onIndex,
}: {
  photos: any[];
  index: number;
  onClose: () => void;
  onIndex: (i: number) => void;
}) {
  const go = (delta: number) => onIndex((index + delta + photos.length) % photos.length);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    // Stop the page behind from scrolling while the viewer is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  });

  const photo = photos[index];

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[rgba(16,12,10,.94)]">
      <div className="flex flex-none items-center gap-3 px-5 py-3.5 text-white">
        <span className="font-admin text-[13px] font-bold">
          Photo {index + 1} of {photos.length}
        </span>
        {photo?.caption && (
          <span className="truncate text-[12px] text-white/70">{photo.caption}</span>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-white/10 hover:bg-white/20"
        >
          <X className="h-4 w-4" strokeWidth={2.2} />
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4 pb-4">
        {photos.length > 1 && (
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous photo"
            className="absolute left-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={2.2} />
          </button>
        )}

        {/* object-contain, never cover: a cropped review photo hides exactly
            the edges an admin is checking. */}
        <img
          src={photo.url}
          alt={photo.caption || `Photo ${index + 1}`}
          className="max-h-full max-w-full rounded-xl object-contain"
        />

        {photos.length > 1 && (
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next photo"
            className="absolute right-4 flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
          >
            <ChevronRight className="h-5 w-5" strokeWidth={2.2} />
          </button>
        )}
      </div>

      {photos.length > 1 && (
        <div className="flex flex-none justify-center gap-2 overflow-x-auto px-4 pb-5">
          {photos.map((p: any, i: number) => (
            <button
              key={i}
              type="button"
              onClick={() => onIndex(i)}
              className={`h-12 w-16 flex-none overflow-hidden rounded-lg border-2 ${
                i === index ? 'border-[#B46A55]' : 'border-transparent opacity-55 hover:opacity-100'
              }`}
            >
              <img src={p.url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
