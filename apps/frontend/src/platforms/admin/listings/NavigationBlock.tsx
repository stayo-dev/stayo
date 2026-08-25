import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ImagePlus, Navigation, Trash2 } from 'lucide-react';
import { platformAdminService } from '@features/platform-admin/api';
import { useToast } from '../layout/toastContext';
import { coordinatesHint, embedUrlHint, extractEmbedSrc, parseCoordinates } from './parseCoordinates';

/**
 * Where an admin enters how to find this hostel's front door.
 *
 * **This block has no owner-side equivalent, deliberately.** The Place ID
 * decides where Stayo sends a student walking; an owner able to edit it could
 * point arrivals at a better-looking building than their own. Same side of the
 * line as `listing_status` (ADR-040), and the server enforces it too — the
 * routes behind these calls are ADMIN-only, not merely admin-shaped.
 *
 * It sits outside the review branch on purpose: navigation is hostel-level, not
 * revision-level, so a hostel already live with no pending submission — which is
 * every hostel on Stayo the day this shipped — can still be located.
 */

interface NavigationDraft {
  placeId: string;
  landmark: string;
  entrancePhoto: string | null;
  distanceFromReference: string;
  referenceName: string;
  /** Kept as text so a half-typed coordinate is not silently coerced to 0. */
  coordinates: string;
  embedUrl: string;
}

const EMPTY: NavigationDraft = {
  placeId: '',
  landmark: '',
  entrancePhoto: null,
  distanceFromReference: '',
  referenceName: 'SNIST',
  coordinates: '',
  embedUrl: '',
};

const FIELD =
  'w-full rounded-[11px] border border-[#E7DDD1] bg-white px-3 py-2.5 text-[12.5px] text-[#2A2521] outline-none focus:border-[#B46A55]';
const LABEL = 'mb-1.5 block text-[11px] font-semibold text-[#8A7F75]';

export function NavigationBlock({ hostelId }: { hostelId: string }) {
  const fireToast = useToast();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<NavigationDraft>(EMPTY);
  const [uploading, setUploading] = useState(false);

  const navigation = useQuery({
    queryKey: ['admin', 'hostel-navigation', hostelId],
    queryFn: () => platformAdminService.getNavigation(hostelId),
  });

  // The server's copy is the source of truth; the draft is what the admin is
  // currently typing. Re-seeded when the hostel changes, not on every render,
  // so a save that returns does not wipe a field mid-edit.
  useEffect(() => {
    const saved = navigation.data?.navigation;
    setDraft(
      saved
        ? {
            placeId: saved.placeId ?? '',
            landmark: saved.landmark ?? '',
            entrancePhoto: saved.entrancePhoto ?? null,
            distanceFromReference: saved.distanceFromReference ?? '',
            coordinates:
              typeof saved.lat === 'number' && typeof saved.lng === 'number'
                ? `${saved.lat}, ${saved.lng}`
                : '',
            embedUrl: saved.embedUrl ?? '',
            referenceName: saved.referenceName ?? 'SNIST',
          }
        : EMPTY,
    );
  }, [navigation.data?.navigation, hostelId]);

  const save = useMutation({
    mutationFn: (value: NavigationDraft | null) =>
      platformAdminService.saveNavigation(
        hostelId,
        value === null
          ? null
          : {
              placeId: value.placeId.trim(),
              landmark: value.landmark.trim() || null,
              entrancePhoto: value.entrancePhoto,
              distanceFromReference: value.distanceFromReference.trim() || null,
              referenceName: value.referenceName.trim() || 'SNIST',
              ...parseCoordinates(value.coordinates),
              // Google's dialog copies the whole <iframe> tag, so normalise the
              // paste to its src before the server's allowlist sees it.
              embedUrl: extractEmbedSrc(value.embedUrl) || null,
            },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'hostel-navigation', hostelId] });
    },
  });

  const onPickPhoto = async (file: File) => {
    setUploading(true);
    try {
      const { url } = await platformAdminService.uploadEntrancePhoto(hostelId, file);
      setDraft((d) => ({ ...d, entrancePhoto: url }));
      fireToast('Entrance photo uploaded — save to keep it');
    } catch (error: any) {
      fireToast(error?.response?.data?.error?.message || 'Could not upload that photo', 'no');
    } finally {
      setUploading(false);
    }
  };

  const located = Boolean(navigation.data?.navigation);
  const gaps = navigation.data?.gaps ?? [];

  return (
    <div className="mb-3 rounded-2xl border border-[#EFE6DA] bg-white p-4">
      <div className="flex items-center gap-2">
        <Navigation className="h-4 w-4 flex-none" strokeWidth={2} style={{ color: '#B46A55' }} />
        <div className="font-admin text-[13.5px] font-bold text-[#221E1A]">Navigation</div>
        <div className="flex-1" />
        {located && gaps.length === 0 && (
          <span className="rounded-full bg-[#EAF3EE] px-2 py-[3px] text-[10px] font-semibold text-[#1F7A52]">
            Complete
          </span>
        )}
      </div>

      {/*
        A warning rather than a block. Two hostels were already live with no
        Place ID the day this shipped, and a hard gate on approval would have
        made them unfixable through the normal flow — an admin stuck mid-approval
        with no way forward. Loud, not locked.
      */}
      {!located && (
        <div className="mt-2.5 flex gap-2 rounded-[11px] bg-[#FBF1DE] p-2.5">
          <AlertTriangle className="h-3.5 w-3.5 flex-none" strokeWidth={2} style={{ color: '#B8792B' }} />
          <div className="text-[11.5px] leading-[1.5] text-[#8A6A31]">
            No Place ID — students get no directions to this hostel. Paste one from
            Google&apos;s Place ID Finder.
          </div>
        </div>
      )}

      <div className="mt-3 space-y-3">
        <div>
          <label className={LABEL} htmlFor={`place-${hostelId}`}>Google Place ID</label>
          <input
            id={`place-${hostelId}`}
            value={draft.placeId}
            onChange={(e) => setDraft((d) => ({ ...d, placeId: e.target.value }))}
            placeholder="ChIJ…"
            spellCheck={false}
            className={`${FIELD} font-mono`}
          />
        </div>

        <div>
          <label className={LABEL} htmlFor={`landmark-${hostelId}`}>Landmark</label>
          <input
            id={`landmark-${hostelId}`}
            value={draft.landmark}
            onChange={(e) => setDraft((d) => ({ ...d, landmark: e.target.value }))}
            placeholder="Opposite SNIST Gate 2"
            className={FIELD}
          />
        </div>

        <div>
          <label className={LABEL} htmlFor={`coords-${hostelId}`}>Map pin — latitude, longitude</label>
          <input
            id={`coords-${hostelId}`}
            value={draft.coordinates}
            onChange={(e) => setDraft((d) => ({ ...d, coordinates: e.target.value }))}
            placeholder="17.4542678, 78.6628497"
            className={FIELD}
          />
          {/*
            Search the hostel on Google and copy the pair straight out of the
            result. This is what draws the map on the listing; the Place ID above
            is what opens directions. Optional — without it the listing shows the
            landmark and entrance photo instead of an empty map frame.
          */}
          <p className="mt-1 text-[11px] text-[#8A7F75]">
            {coordinatesHint(draft.coordinates) ?? 'Optional. Search the hostel on Google and paste the two numbers.'}
          </p>
        </div>

        <div>
          <label className={LABEL} htmlFor={`embed-${hostelId}`}>Google embed URL — optional</label>
          <input
            id={`embed-${hostelId}`}
            value={draft.embedUrl}
            onChange={(e) => setDraft((d) => ({ ...d, embedUrl: e.target.value }))}
            placeholder='Paste the whole <iframe …> from Google Maps'
            className={FIELD}
          />
          {/*
            Google Maps → Share → Embed a map → copy the src out of the iframe.
            This renders the place card (name, address, rating); the coordinates
            above render a plain pin. Only Google embed URLs are accepted —
            this value ends up in an iframe, so anything else is a phishing
            surface rather than a map.
          */}
          <p className="mt-1 text-[11px] text-[#8A7F75]">
            {embedUrlHint(draft.embedUrl) ?? 'Optional. Maps → Share → Embed a map → Copy HTML, and paste the whole thing. Shows the rating card.'}
          </p>
        </div>

        <div className="flex gap-2.5">
          <div className="flex-1">
            <label className={LABEL} htmlFor={`distance-${hostelId}`}>Distance</label>
            <input
              id={`distance-${hostelId}`}
              value={draft.distanceFromReference}
              onChange={(e) => setDraft((d) => ({ ...d, distanceFromReference: e.target.value }))}
              placeholder="400m"
              className={FIELD}
            />
          </div>
          <div className="flex-1">
            <label className={LABEL} htmlFor={`reference-${hostelId}`}>From</label>
            <input
              id={`reference-${hostelId}`}
              value={draft.referenceName}
              onChange={(e) => setDraft((d) => ({ ...d, referenceName: e.target.value }))}
              placeholder="SNIST"
              className={FIELD}
            />
          </div>
        </div>

        <div>
          <span className={LABEL}>Entrance photo</span>
          <div className="flex items-center gap-2.5">
            {draft.entrancePhoto ? (
              <div
                className="h-14 w-20 flex-none rounded-[10px] bg-cover bg-center"
                style={{ backgroundImage: `url(${draft.entrancePhoto})` }}
              />
            ) : (
              <div className="flex h-14 w-20 flex-none items-center justify-center rounded-[10px] border border-dashed border-[#E7DDD1] text-[10px] text-[#B0A597]">
                None
              </div>
            )}
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) onPickPhoto(file);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileInput.current?.click()}
              className="flex items-center gap-1.5 rounded-[10px] border border-[#E9DFD3] bg-white px-2.5 py-2 text-[11.5px] font-semibold text-[#5A5147] disabled:opacity-50"
            >
              <ImagePlus className="h-3.5 w-3.5" strokeWidth={2} />
              {uploading ? 'Uploading…' : draft.entrancePhoto ? 'Replace' : 'Upload'}
            </button>
            {draft.entrancePhoto && (
              <button
                type="button"
                aria-label="Remove entrance photo"
                onClick={() => setDraft((d) => ({ ...d, entrancePhoto: null }))}
                className="rounded-[10px] border border-[#E9DFD3] bg-white p-2 text-[#8A7F75]"
              >
                <Trash2 className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-3.5 flex items-center gap-2">
        {located && (
          <button
            type="button"
            onClick={async () => {
              try {
                await save.mutateAsync(null);
                fireToast('Navigation cleared');
              } catch {
                fireToast('Could not clear that', 'no');
              }
            }}
            className="rounded-[10px] border border-[#E9DFD3] bg-white px-3 py-2 text-[11.5px] font-semibold text-[#8A7F75]"
          >
            Clear
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          disabled={save.isPending || !draft.placeId.trim()}
          onClick={async () => {
            try {
              await save.mutateAsync(draft);
              fireToast('Navigation saved');
            } catch (error: any) {
              fireToast(
                error?.response?.data?.error?.message || 'Could not save that Place ID',
                'no',
              );
            }
          }}
          className="rounded-[10px] bg-[#B46A55] px-4 py-2 font-admin text-[12px] font-bold text-white disabled:opacity-40"
        >
          {save.isPending ? 'Saving…' : 'Save navigation'}
        </button>
      </div>
    </div>
  );
}
