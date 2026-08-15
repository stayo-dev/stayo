import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ImagePlus, Loader2, Star, Trash2, UploadCloud } from 'lucide-react';

import { stayoToast } from '@shared/ui-patterns/Toast';
import { marketingService, type MarketingPhoto } from '@features/hostel-marketing/api';

import { M } from './marketingTheme';

/** Matches the server's own limits, so an impossible upload fails before it starts. */
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_BYTES = 8 * 1024 * 1024;
const MAX_PER_UPLOAD = 10;
/** The content schema's own ceiling. */
const MAX_PHOTOS = 24;

/**
 * `MODAL: MARKETING PHOTOS` of `Stayo App.dc.html` — the full-screen photo
 * manager: a 2-up grid with star (set cover) and trash on every tile.
 *
 * Photos are uploaded from the device — the file picker, or dropped onto the
 * grid on a desktop. Uploads go straight to ImageKit via
 * `POST /owner/hostels/:id/marketing/photos`, which hands back URLs; those URLs
 * live in the draft until the owner saves, so an upload the owner then discards
 * never reaches the listing.
 */
export function PhotosScreen({
  open,
  hostelId,
  photos,
  onChange,
  onClose,
}: {
  open: boolean;
  hostelId: string | undefined;
  photos: MarketingPhoto[];
  onChange: (next: MarketingPhoto[]) => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Nested dragenter/dragleave pairs fire as the pointer crosses child
  // elements, so a plain boolean flickers the drop state off mid-drag.
  const dragDepth = useRef(0);

  if (!open) return null;

  const remainingSlots = MAX_PHOTOS - photos.length;

  const setCover = (index: number) =>
    onChange(photos.map((photo, i) => ({ ...photo, is_cover: i === index })));

  const remove = (index: number) => {
    const next = photos.filter((_photo, i) => i !== index);
    // The cover must survive its own deletion — a listing with no cover has no
    // card image in search.
    if (next.length > 0 && !next.some((photo) => photo.is_cover)) next[0].is_cover = true;
    onChange(next.map((photo, i) => ({ ...photo, sort: i })));
  };

  /**
   * Everything that puts files into the listing funnels through here — the
   * picker and the drop target must not diverge on what they accept.
   */
  const upload = async (picked: File[]) => {
    if (!hostelId || picked.length === 0) return;

    if (remainingSlots <= 0) {
      stayoToast.info(`A listing can show ${MAX_PHOTOS} photos. Remove one to add another.`);
      return;
    }

    const images = picked.filter((file) => ACCEPTED_TYPES.includes(file.type));
    const tooBig = images.filter((file) => file.size > MAX_BYTES);
    let accepted = images.filter((file) => file.size <= MAX_BYTES);

    // Say what is being dropped and why, rather than silently uploading a
    // subset of what the owner selected.
    if (images.length < picked.length) stayoToast.info('Only JPG, PNG and WebP images can be uploaded');
    if (tooBig.length > 0) stayoToast.error(`${tooBig.length} photo(s) over 8MB were skipped`);

    if (accepted.length > remainingSlots) {
      stayoToast.info(`Only ${remainingSlots} more photo(s) fit on this listing`);
      accepted = accepted.slice(0, remainingSlots);
    }
    if (accepted.length === 0) return;

    // The server caps a single request; batch rather than refusing the rest.
    const batches: File[][] = [];
    for (let i = 0; i < accepted.length; i += MAX_PER_UPLOAD) {
      batches.push(accepted.slice(i, i + MAX_PER_UPLOAD));
    }

    setUploading(accepted.length);
    let added: MarketingPhoto[] = [];
    try {
      for (const batch of batches) {
        const result = await marketingService.uploadPhotos(hostelId, batch);
        added = [
          ...added,
          ...result.map((photo, index) => ({
            url: photo.url,
            label: null,
            is_cover: photos.length === 0 && added.length + index === 0,
            sort: photos.length + added.length + index,
          })),
        ];
      }
      onChange([...photos, ...added]);
      stayoToast.success(added.length === 1 ? 'Photo added' : `${added.length} photos added`);
    } catch (error: any) {
      // Whatever did land is kept — losing three successful uploads because the
      // fourth failed is worse than a partial batch.
      if (added.length > 0) onChange([...photos, ...added]);
      stayoToast.error(error?.response?.data?.message ?? 'Could not upload those photos');
    } finally {
      setUploading(0);
    }
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    upload(Array.from(event.dataTransfer.files ?? []));
  };

  const busy = uploading > 0;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: '#F5EFE8' }}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={(event) => {
        event.preventDefault();
        dragDepth.current -= 1;
        if (dragDepth.current <= 0) setDragging(false);
      }}
      onDrop={onDrop}
    >
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
          {photos.length > 0 && ` · ${photos.length} of ${MAX_PHOTOS}`}
        </p>

        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_TYPES.join(',')}
          multiple
          className="hidden"
          onChange={(event) => {
            upload(Array.from(event.target.files ?? []));
            // Reset, or picking the same file twice in a row fires nothing.
            event.target.value = '';
          }}
        />

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

          {/* Placeholder tiles while the batch is in flight, so the grid grows
              immediately instead of sitting still through a slow upload. */}
          {Array.from({ length: uploading }).map((_unused, index) => (
            <div
              key={`pending-${index}`}
              className="flex h-[150px] flex-col items-center justify-center gap-2 rounded-[15px]"
              style={{ border: `1.5px dashed ${M.dashed}`, background: M.dashedBg }}
            >
              <Loader2 className="h-5 w-5 animate-spin text-primary" strokeWidth={2} />
              <span className="text-[11px] font-semibold text-muted-foreground">Uploading…</span>
            </div>
          ))}

          {remainingSlots > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="flex h-[150px] flex-col items-center justify-center gap-[7px] rounded-[15px] px-3 text-center text-primary disabled:opacity-60"
              style={{ border: `1.5px dashed ${M.dashed}`, background: M.dashedBg }}
            >
              <ImagePlus className="h-5 w-5" strokeWidth={1.8} />
              <span className="font-display text-[12px] font-bold">Add photos</span>
              <span className="text-[10.5px] font-medium leading-[1.4]" style={{ color: M.ghost }}>
                Choose from your device
              </span>
            </button>
          )}
        </div>

        {photos.length === 0 && !busy && (
          <p className="mt-4 text-center text-[11.5px]" style={{ color: M.ghost }}>
            JPG, PNG or WebP · up to 8MB each
          </p>
        )}
      </div>

      {/* Desktop drag-and-drop. The listener is on the whole screen so a drop
          anywhere lands, and this is only the visual confirmation. */}
      {dragging && (
        <div
          className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3"
          style={{ background: 'rgba(245,239,232,.92)', border: `2px dashed ${M.dashedClay}` }}
        >
          <UploadCloud className="h-9 w-9 text-primary" strokeWidth={1.6} />
          <p className="font-display text-[15px] font-bold text-foreground">Drop photos to upload</p>
          <p className="text-[12px] text-muted-foreground">JPG, PNG or WebP · up to 8MB each</p>
        </div>
      )}
    </div>,
    document.body,
  );
}
