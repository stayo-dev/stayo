import { useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ImagePlus, Star, Trash2, X } from 'lucide-react';

import type { MarketingPhoto } from '@features/hostel-marketing/api';

import { M } from './marketingTheme';

/**
 * `MODAL: MARKETING PHOTOS` of `Stayo App.dc.html` — the full-screen photo
 * manager, a 2-up grid with star (set cover) and trash on every tile.
 *
 * Photos are added by URL rather than uploaded. ImageKit upload exists
 * elsewhere in this app (profile photos, documents) and wiring it in is its own
 * piece of work; a URL field stores exactly what the listing will render rather
 * than pretending an upload happened. Carried over from the page this replaces.
 */
export function PhotosScreen({
  open,
  photos,
  onChange,
  onClose,
}: {
  open: boolean;
  photos: MarketingPhoto[];
  onChange: (next: MarketingPhoto[]) => void;
  onClose: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');

  if (!open) return null;

  const setCover = (index: number) =>
    onChange(photos.map((photo, i) => ({ ...photo, is_cover: i === index })));

  const remove = (index: number) => {
    const next = photos.filter((_photo, i) => i !== index);
    // The cover must survive its own deletion — a listing with no cover has no
    // card image in search.
    if (next.length > 0 && !next.some((photo) => photo.is_cover)) next[0].is_cover = true;
    onChange(next.map((photo, i) => ({ ...photo, sort: i })));
  };

  const add = () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    onChange([
      ...photos,
      { url: trimmed, label: null, is_cover: photos.length === 0, sort: photos.length },
    ]);
    setUrl('');
    setAdding(false);
  };

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col" style={{ background: '#F5EFE8' }}>
      <header
        className="flex items-center justify-between px-5 pb-3 pt-[max(1rem,env(safe-area-inset-top))]"
        style={{ borderBottom: `1px solid ${M.sheetLine}` }}
      >
        <button type="button" onClick={onClose} className="flex items-center gap-2.5">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-full bg-card"
            style={{ border: `1px solid ${M.sheetLine}`, color: M.closeText }}
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2} />
          </span>
          <span className="font-display text-[17px] font-extrabold text-foreground">Photos</span>
        </button>
        <button type="button" onClick={onClose} className="font-display text-[13px] font-bold text-primary">
          Done
        </button>
      </header>

      <div className="flex-1 overflow-auto px-5 pb-8 pt-4">
        <p className="mb-3.5 text-[12px] leading-[1.6] text-muted-foreground">
          The cover photo shows first in Discovery search. Tap ★ to set the cover.
        </p>

        <div className="grid grid-cols-2 gap-3">
          {photos.map((photo, index) => (
            <div key={`${photo.url}-${index}`} className="relative h-[150px] overflow-hidden rounded-[15px] bg-muted">
              <img src={photo.url} alt={photo.label ?? ''} className="h-full w-full object-cover" />
              {photo.is_cover && (
                <span
                  className="absolute left-[9px] top-[9px] rounded-[7px] px-[9px] py-[3px] text-[9.5px] font-bold tracking-[0.04em] text-white"
                  style={{ background: M.ink }}
                >
                  COVER
                </span>
              )}
              <div className="absolute right-2 top-2 flex gap-1.5">
                <button
                  type="button"
                  aria-label={photo.is_cover ? 'Already the cover' : 'Set as cover'}
                  disabled={photo.is_cover}
                  onClick={() => setCover(index)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.92] disabled:opacity-60"
                >
                  <Star
                    className="h-3.5 w-3.5 text-primary"
                    strokeWidth={2}
                    fill={photo.is_cover ? 'currentColor' : 'none'}
                  />
                </button>
                <button
                  type="button"
                  aria-label="Remove photo"
                  onClick={() => remove(index)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.92]"
                >
                  <Trash2 className="h-3.5 w-3.5 text-destructive" strokeWidth={2} />
                </button>
              </div>
              <input
                value={photo.label ?? ''}
                placeholder="Caption"
                onChange={(event) =>
                  onChange(photos.map((p, i) => (i === index ? { ...p, label: event.target.value } : p)))
                }
                className="absolute inset-x-0 bottom-0 border-0 bg-gradient-to-t from-[rgba(30,24,20,.55)] to-transparent px-2.5 py-2 text-[11px] font-semibold text-white outline-none placeholder:text-white/60"
              />
            </div>
          ))}

          {adding ? (
            <div
              className="flex h-[150px] flex-col gap-2 rounded-[15px] bg-card p-3"
              style={{ border: `1px solid ${M.inputLine}` }}
            >
              <input
                autoFocus
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && add()}
                placeholder="https://…"
                className="w-full rounded-lg bg-muted px-2.5 py-2 text-[12px] outline-none"
                style={{ border: `1px solid ${M.inputLine}` }}
              />
              <div className="mt-auto flex gap-1.5">
                <button
                  type="button"
                  onClick={add}
                  className="flex-1 rounded-lg bg-primary py-2 text-[11.5px] font-bold text-primary-foreground"
                >
                  Add
                </button>
                <button
                  type="button"
                  aria-label="Cancel"
                  onClick={() => {
                    setAdding(false);
                    setUrl('');
                  }}
                  className="rounded-lg px-2.5 py-2 text-muted-foreground"
                  style={{ border: `1px solid ${M.inputLine}` }}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setAdding(true)}
              className="flex h-[150px] flex-col items-center justify-center gap-[7px] rounded-[15px] text-primary"
              style={{ border: `1.5px dashed ${M.dashed}`, background: M.dashedBg }}
            >
              <ImagePlus className="h-5 w-5" strokeWidth={1.8} />
              <span className="font-display text-[12px] font-bold">Add photo</span>
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
