import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronLeft as MoveLeft,
  ChevronRight as MoveRight,
  ImagePlus,
  Loader2,
  Play,
  Star,
  Trash2,
  UploadCloud,
} from 'lucide-react';

import { stayoToast } from '@shared/ui-patterns/Toast';
import { marketingService, type MarketingPhoto } from '@features/hostel-marketing/api';

import { M } from './marketingTheme';
import { PHOTO_CATEGORIES } from './photoCategories';
import {
  IMAGE_TYPES,
  MAX_MEDIA,
  VIDEO_TYPES,
  canBeCover,
  classifyFiles,
  compressImage,
  removeMedia,
  reorderMedia,
  setCover as setCoverAt,
} from './mediaUpload';

const ACCEPTED_TYPES = [...IMAGE_TYPES, ...VIDEO_TYPES];

/**
 * `MODAL: MARKETING PHOTOS` of `Stayo App.dc.html` — the full-screen media
 * manager: a 2-up grid with cover, caption, reorder and delete on every tile.
 *
 * Photos **and videos** are uploaded from the device — the file picker, or
 * dropped onto the grid on a desktop — through
 * `POST /owner/hostels/:id/marketing/photos`, **one file per request** (see
 * `marketingService.uploadMedia` for why). The returned URLs live in the draft
 * until the owner saves, so an upload they then discard never reaches the
 * listing.
 *
 * All the rules — what is accepted, what the cover may be, what order things
 * are in — live in `mediaUpload.ts` and are tested there.
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
  const [pending, setPending] = useState(0);
  const [done, setDone] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Nested dragenter/dragleave pairs fire as the pointer crosses child
  // elements, so a plain boolean flickers the drop state off mid-drag.
  const dragDepth = useRef(0);
  // Which tile is being dragged to a new position (desktop reordering).
  const dragFrom = useRef<number | null>(null);

  if (!open) return null;

  const remainingSlots = MAX_MEDIA - photos.length;

  const move = (from: number, to: number) => {
    if (to < 0 || to >= photos.length) return;
    onChange(reorderMedia(photos, from, to));
  };

  /**
   * Everything that puts files into the listing funnels through here — the
   * picker and the drop target must not diverge on what they accept.
   */
  const upload = async (picked: File[]) => {
    if (!hostelId || picked.length === 0) return;

    if (remainingSlots <= 0) {
      stayoToast.info(`A listing can show ${MAX_MEDIA} photos and videos. Remove one to add another.`);
      return;
    }

    const { accepted, wrongType, tooBig, overflow } = classifyFiles(picked, remainingSlots);

    // Say what is being dropped and why, rather than silently uploading a
    // subset of what the owner selected.
    if (wrongType.length > 0) stayoToast.info('Only JPG, PNG, WebP photos and MP4, WebM, MOV videos can be uploaded');
    if (tooBig.length > 0) {
      stayoToast.error(
        tooBig.length === 1
          ? `"${tooBig[0].name}" is too large — photos up to 8MB, videos up to 60MB`
          : `${tooBig.length} files were too large — photos up to 8MB, videos up to 60MB`,
      );
    }
    if (overflow.length > 0) stayoToast.info(`Only ${remainingSlots} more file(s) fit on this listing`);
    if (accepted.length === 0) return;

    setPending(accepted.length);
    setDone(0);

    // One request per file, sequentially. A batch was what made a normal
    // phone multi-select fail as "limit exceeded"; sequential also keeps a
    // handful of large uploads from competing for one mobile connection.
    let added: MarketingPhoto[] = [];
    let failed = 0;
    for (const file of accepted) {
      try {
        const uploaded = await marketingService.uploadMedia(hostelId, await compressImage(file));
        if (!uploaded) {
          failed += 1;
          continue;
        }
        added = [
          ...added,
          {
            url: uploaded.url,
            label: null,
            kind: uploaded.kind,
            thumbnail_url: uploaded.thumbnail_url,
            // The first image on an empty listing becomes the cover; a video
            // never can (it is the search card's still and a link's preview).
            is_cover:
              uploaded.kind !== 'video' &&
              ![...photos, ...added].some((item) => item.is_cover && item.kind !== 'video'),
            sort: photos.length + added.length,
          },
        ];
        // Kept as they land: an upload that fails halfway must not discard the
        // ones that already succeeded.
        onChange([...photos, ...added]);
      } catch (error: any) {
        failed += 1;
        const message = error?.response?.data?.message;
        // One toast per failure would bury the screen on a bad connection.
        if (failed === 1 && message) stayoToast.error(message);
      } finally {
        setDone((count) => count + 1);
      }
    }

    setPending(0);
    setDone(0);
    if (added.length > 0) {
      stayoToast.success(added.length === 1 ? 'Added' : `${added.length} files added`);
    }
    if (failed > 0) {
      stayoToast.error(failed === 1 ? "One file didn't upload" : `${failed} files didn't upload`);
    }
  };

  const onDrop = (event: React.DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    // A tile being dragged within the grid carries no files — that is a
    // reorder, handled on the tile itself.
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0) upload(files);
  };

  const busy = pending > 0;
  const imageCount = photos.filter((photo) => photo.kind !== 'video').length;

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: '#F5EFE8' }}
      onDragEnter={(event) => {
        event.preventDefault();
        dragDepth.current += 1;
        if (dragFrom.current === null) setDragging(true);
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
          <span className="font-display text-[17px] font-extrabold text-foreground">Photos & videos</span>
        </button>
        <button type="button" onClick={onClose} className="font-display text-[13px] font-bold text-primary">
          Done
        </button>
      </header>

      <div className="flex-1 overflow-auto px-5 pb-8 pt-4">
        <p className="mb-3.5 text-[12px] leading-[1.6] text-muted-foreground">
          The order here is the order visitors swipe through — use ‹ › to rearrange. Tap ★ to set the
          cover photo, which shows first in Discovery search. Label each one with the part of the
          hostel it shows; the listing groups them into a photo tour.
          {photos.length > 0 && ` · ${photos.length} of ${MAX_MEDIA}`}
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
          {photos.map((photo, index) => {
            const isVideo = photo.kind === 'video';
            return (
              <div
                key={`${photo.url}-${index}`}
                draggable
                onDragStart={() => {
                  dragFrom.current = index;
                }}
                onDragOver={(event) => {
                  if (dragFrom.current !== null) event.preventDefault();
                }}
                onDrop={(event) => {
                  if (dragFrom.current === null) return;
                  event.preventDefault();
                  event.stopPropagation();
                  move(dragFrom.current, index);
                  dragFrom.current = null;
                }}
                onDragEnd={() => {
                  dragFrom.current = null;
                }}
                className="relative h-[150px] overflow-hidden rounded-[15px] bg-muted"
              >
                {isVideo ? (
                  <>
                    <video
                      src={photo.url}
                      poster={photo.thumbnail_url ?? undefined}
                      // Metadata only: a grid that autoloads six clips costs
                      // the owner their data allowance to look at a page.
                      preload="metadata"
                      muted
                      playsInline
                      className="h-full w-full object-cover"
                    />
                    <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55">
                        <Play className="h-4 w-4 text-white" fill="currentColor" strokeWidth={0} />
                      </span>
                    </span>
                  </>
                ) : (
                  <img src={photo.url} alt={photo.label ?? ''} className="h-full w-full object-cover" />
                )}

                {photo.is_cover && (
                  <span
                    className="absolute left-[9px] top-[9px] rounded-[7px] px-[9px] py-[3px] text-[9.5px] font-bold tracking-[0.04em] text-white"
                    style={{ background: M.ink }}
                  >
                    COVER
                  </span>
                )}

                <div className="absolute right-2 top-2 flex gap-1.5">
                  {canBeCover(photo) && (
                    <button
                      type="button"
                      aria-label={photo.is_cover ? 'Already the cover' : 'Set as cover'}
                      disabled={photo.is_cover}
                      onClick={() => onChange(setCoverAt(photos, index))}
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.92] disabled:opacity-60"
                    >
                      <Star
                        className="h-3.5 w-3.5 text-primary"
                        strokeWidth={2}
                        fill={photo.is_cover ? 'currentColor' : 'none'}
                      />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={isVideo ? 'Remove video' : 'Remove photo'}
                    onClick={() => onChange(removeMedia(photos, index))}
                    className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.92]"
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" strokeWidth={2} />
                  </button>
                </div>

                {/* Reorder. Buttons rather than drag alone: dragging a tile is
                    unreliable on touch, which is where most owners are. */}
                <div className="absolute left-2 top-2 flex gap-1.5">
                  {index > 0 && (
                    <button
                      type="button"
                      aria-label="Move earlier"
                      onClick={() => move(index, index - 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.92]"
                    >
                      <MoveLeft className="h-3.5 w-3.5 text-foreground" strokeWidth={2.2} />
                    </button>
                  )}
                  {index < photos.length - 1 && (
                    <button
                      type="button"
                      aria-label="Move later"
                      onClick={() => move(index, index + 1)}
                      className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/[0.92]"
                    >
                      <MoveRight className="h-3.5 w-3.5 text-foreground" strokeWidth={2.2} />
                    </button>
                  )}
                </div>

                {/* Which part of the hostel this is. The listing groups the
                    photo tour by it, so an unlabelled photo lands in "More
                    photos" rather than being lost. */}
                <select
                  value={photo.category ?? 'other'}
                  onChange={(event) =>
                    onChange(photos.map((p, i) => (i === index ? { ...p, category: event.target.value } : p)))
                  }
                  onClick={(event) => event.stopPropagation()}
                  className="absolute bottom-[30px] left-2 rounded-[7px] border-0 bg-black/55 px-1.5 py-1 text-[10px] font-semibold text-white outline-none"
                >
                  {PHOTO_CATEGORIES.map((category) => (
                    <option key={category.key} value={category.key} className="text-foreground">
                      {category.label}
                    </option>
                  ))}
                </select>

                <input
                  value={photo.label ?? ''}
                  placeholder="Caption"
                  onChange={(event) =>
                    onChange(photos.map((p, i) => (i === index ? { ...p, label: event.target.value } : p)))
                  }
                  className="absolute inset-x-0 bottom-0 border-0 bg-gradient-to-t from-[rgba(30,24,20,.55)] to-transparent px-2.5 py-2 text-[11px] font-semibold text-white outline-none placeholder:text-white/60"
                />
              </div>
            );
          })}

          {/* Placeholder tiles for what is still in flight, so the grid grows
              immediately instead of sitting still through a slow upload. */}
          {Array.from({ length: Math.max(pending - done, 0) }).map((_unused, index) => (
            <div
              key={`pending-${index}`}
              className="flex h-[150px] flex-col items-center justify-center gap-2 rounded-[15px]"
              style={{ border: `1.5px dashed ${M.dashed}`, background: M.dashedBg }}
            >
              <Loader2 className="h-5 w-5 animate-spin text-primary" strokeWidth={2} />
              <span className="text-[11px] font-semibold text-muted-foreground">
                {pending > 1 ? `Uploading ${done + 1} of ${pending}…` : 'Uploading…'}
              </span>
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
              <span className="font-display text-[12px] font-bold">Add photos or videos</span>
              <span className="text-[10.5px] font-medium leading-[1.4]" style={{ color: M.ghost }}>
                Choose from your device
              </span>
            </button>
          )}
        </div>

        {photos.length > 0 && imageCount === 0 && (
          <p className="mt-4 text-center text-[11.5px] text-destructive">
            Add at least one photo — a video can't be the cover image Discovery shows on your card.
          </p>
        )}

        {photos.length === 0 && !busy && (
          <p className="mt-4 text-center text-[11.5px]" style={{ color: M.ghost }}>
            JPG, PNG or WebP up to 8MB · MP4, WebM or MOV up to 60MB
          </p>
        )}
      </div>

      {/* Desktop drag-and-drop of files from outside the browser. The listener
          is on the whole screen so a drop anywhere lands; this is only the
          visual confirmation, and it stays out of the way while a tile is
          being dragged to a new position. */}
      {dragging && dragFrom.current === null && (
        <div
          className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center gap-3"
          style={{ background: 'rgba(245,239,232,.92)', border: `2px dashed ${M.dashedClay}` }}
        >
          <UploadCloud className="h-9 w-9 text-primary" strokeWidth={1.6} />
          <p className="font-display text-[15px] font-bold text-foreground">Drop photos or videos to upload</p>
          <p className="text-[12px] text-muted-foreground">Photos up to 8MB · videos up to 60MB</p>
        </div>
      )}
    </div>,
    document.body,
  );
}
