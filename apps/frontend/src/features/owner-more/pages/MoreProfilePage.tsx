import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Camera, Loader2 } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { formatIndianPhone } from '@shared/lib/phone';
import { profileIdentity } from '../config/profileIdentity';
import { ownerService } from '@features/owners/api';
import { useUpdateOwnerProfile } from '@features/settings/settingsHooks';
import { queryKeys } from '@lib/queryKeys';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { SaveBar } from '../components/SaveBar';
import { hasChanges } from '../config/dirtyState';

interface ProfileFields {
  name: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
}

const EMPTY_PROFILE: ProfileFields = { name: '', address: '', city: '', state: '', pincode: '' };

interface OwnerProfile {
  name: string;
  email: string;
  phone: string;
  role: string;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  photo_url: string | null;
}

/** Matches the backend's own cap and accepted types, so the two agree. */
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const ACCEPTED_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

const field =
  'w-full rounded-[11px] border border-border bg-card px-3.5 py-2.5 text-[14px] text-foreground outline-none focus:border-primary';
const label = 'text-[12px] font-semibold text-muted-foreground';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

/**
 * A fact Stayo holds about the owner that this screen cannot change.
 *
 * Email and phone used to render as `<input disabled>` — a form field styled
 * at 60% opacity that never accepts a keystroke, which reads as *broken* or as
 * *you lack permission* rather than the truth: changing a phone number needs
 * OTP verification and changing an email is not built.
 *
 * Stated in the same label-above-value rhythm as the fields around it, but as
 * plain text with no box. The box is what says "type here"; without one the
 * row is legible as a fact and still lines up with everything else.
 */
function ReadOnlyField({ label: text, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className={label}>{text}</span>
      <span className="px-0.5 text-[14px] font-semibold text-foreground">{value || '—'}</span>
      {note && <span className="px-0.5 text-[11px] leading-[1.5] text-muted-foreground">{note}</span>}
    </div>
  );
}

/**
 * Profile → Details. Real data via `ownerService.getProfile`
 * (`GET /owner/me/profile`) and `useUpdateOwnerProfile` (`PATCH /owner/me/
 * profile`).
 *
 * Exactly one field up top is editable, and the screen says so by its shape:
 * Name is an input, while email and phone are stated as plain values. They
 * were `<input disabled>` before — three identical-looking fields where two
 * silently rejected every keystroke, with an apology under one of them.
 * Changing a phone number requires the OTP step the backend enforces
 * (`phone_otp`) and changing an email is not built; neither is a thing this
 * screen can do, so neither is drawn as a thing this screen can do.
 *
 * **No cards.** Every field sat inside a white card on a white-ish ground, so
 * the input's own white fill had almost nothing to sit against and the edge
 * that says *type here* washed out. Fields now sit directly on the page, one
 * label above one control, matching Password and Payouts — the three screens
 * of an owner's account read as one screen repeated, not three designs.
 */
export function MoreProfilePage() {
  const navigate = useNavigate();
  const profileQuery = useQuery({
    queryKey: queryKeys.owner.profile(),
    queryFn: async () => (await ownerService.getProfile())?.data?.owner as OwnerProfile,
    staleTime: 60_000,
  });
  const updateMutation = useUpdateOwnerProfile();

  /** One object so the baseline comparison behind Save is a single exact check. */
  const [fields, setFields] = useState<ProfileFields>(EMPTY_PROFILE);
  const [baseline, setBaseline] = useState<ProfileFields | null>(null);

  useEffect(() => {
    const p = profileQuery.data;
    if (p) {
      const loaded: ProfileFields = {
        name: p.name ?? '',
        address: p.address ?? '',
        city: p.city ?? '',
        state: p.state ?? '',
        pincode: p.pincode ?? '',
      };
      setFields(loaded);
      setBaseline(loaded);
    }
  }, [profileQuery.data]);

  const set = <K extends keyof ProfileFields>(key: K, value: ProfileFields[K]) =>
    setFields((prev) => ({ ...prev, [key]: value }));

  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  /**
   * The photo saves on pick, not on Save.
   *
   * It is an upload, not an edit: there is no half-typed state to hold and
   * nothing to compare against a baseline, so folding it into the dirty-state
   * bar would mean an owner picks a picture, sees it appear, walks away, and
   * loses it. Every other field on this screen is text that Save commits.
   */
  const photoMutation = useMutation({
    mutationFn: (file: File) => ownerService.uploadProfilePhoto(file),
    onSuccess: () => {
      stayoToast.success('Photo updated');
      queryClient.invalidateQueries({ queryKey: queryKeys.owner.profile() });
    },
    onError: () => stayoToast.error('Could not upload that photo'),
  });

  const removePhotoMutation = useMutation({
    mutationFn: () => ownerService.removeProfilePhoto(),
    onSuccess: () => {
      stayoToast.success('Photo removed');
      queryClient.invalidateQueries({ queryKey: queryKeys.owner.profile() });
    },
    onError: () => stayoToast.error('Could not remove your photo'),
  });

  const pickPhoto = (file: File | undefined) => {
    if (!file) return;
    // Checked here as well as on the server so the owner is told immediately,
    // rather than after uploading two megabytes to be refused.
    if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
      stayoToast.error('Photo must be a JPG, PNG or WEBP');
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      stayoToast.error('Photo must be under 2MB');
      return;
    }
    photoMutation.mutate(file);
  };

  const { name, address, city, state, pincode } = fields;
  const dirty = hasChanges(baseline, fields);

  const photo = profileQuery.data?.photo_url ?? null;
  // Same derivation the header uses, so the fallback letters match rather than
  // being computed a second way on a second screen.
  const { initials } = profileIdentity({
    profileName: profileQuery.data?.name,
    email: profileQuery.data?.email,
  });

  const save = () => {
    if (!name.trim()) {
      stayoToast.error('Name is required');
      return;
    }
    updateMutation.mutate(
      { name: name.trim(), address: address.trim() || null, city: city.trim() || null, state: state.trim() || null, pincode: pincode.trim() || null },
      {
        onSuccess: () => {
          stayoToast.success('Profile updated');
          navigate('/owner/more');
        },
        onError: () => stayoToast.error('Could not update your profile'),
      },
    );
  };

  return (
    <div className={`flex flex-col gap-6 px-4 pt-6 sm:px-6 ${dirty ? 'pb-40' : 'pb-24'}`}>
      <MoreScreenHeader backTo="/owner/more" backLabel="Profile" title="Details" />

      {profileQuery.isLoading ? (
        <div className="h-64 animate-pulse rounded-2xl bg-muted" />
      ) : (
        <>
          <section className="flex flex-col gap-3">
            <h2 className={sectionLabel}>You</h2>

            {/*
              The photo sits above the fields rather than in a row of its own:
              it is the same thing the header shows, and an owner looking for
              "where do I change my picture" looks at the picture.
            */}
            <div className="flex items-center gap-4 pb-1">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                disabled={photoMutation.isPending}
                aria-label={photo ? 'Change your photo' : 'Add a photo'}
                className="relative h-[72px] w-[72px] flex-none rounded-full"
              >
                {photo ? (
                  <img
                    src={photo}
                    alt=""
                    className="h-full w-full rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center rounded-full bg-primary font-display text-[22px] font-bold text-primary-foreground">
                    {initials}
                  </span>
                )}
                <span className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full border-2 border-background bg-card text-primary shadow-sm">
                  {photoMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2.2} />
                  ) : (
                    <Camera className="h-3.5 w-3.5" strokeWidth={2.2} />
                  )}
                </span>
              </button>

              <div className="flex min-w-0 flex-col gap-1">
                <button
                  type="button"
                  onClick={() => fileInput.current?.click()}
                  disabled={photoMutation.isPending}
                  className="w-fit text-[13px] font-semibold text-primary disabled:opacity-60"
                >
                  {photoMutation.isPending ? 'Uploading…' : photo ? 'Change photo' : 'Add a photo'}
                </button>
                {photo ? (
                  <button
                    type="button"
                    onClick={() => removePhotoMutation.mutate()}
                    disabled={removePhotoMutation.isPending}
                    className="w-fit text-[12px] font-medium text-muted-foreground disabled:opacity-60"
                  >
                    {removePhotoMutation.isPending ? 'Removing…' : 'Remove'}
                  </button>
                ) : (
                  <span className="text-[11.5px] leading-[1.5] text-muted-foreground">
                    JPG, PNG or WEBP, under 2MB
                  </span>
                )}
              </div>

              <input
                ref={fileInput}
                type="file"
                accept={ACCEPTED_PHOTO_TYPES.join(',')}
                className="hidden"
                onChange={(e) => {
                  pickPhoto(e.target.files?.[0]);
                  // Cleared so picking the same file twice still fires change —
                  // otherwise a re-pick after a failed upload does nothing.
                  e.target.value = '';
                }}
              />
            </div>

            <label className="flex flex-col gap-1.5">
              <span className={label}>Name</span>
              <input
                value={name}
                onChange={(e) => set('name', e.target.value)}
                className={field}
                placeholder="Your full name"
              />
            </label>

            <ReadOnlyField label="Email" value={profileQuery.data?.email ?? ''} />

            <ReadOnlyField
              label="Phone"
              value={formatIndianPhone(profileQuery.data?.phone)}
              note="Changing your phone needs OTP verification — not available here yet."
            />
          </section>

          <section className="flex flex-col gap-3">
            <h2 className={sectionLabel}>Address</h2>

            <label className="flex flex-col gap-1.5">
              <span className={label}>Address</span>
              <input value={address} onChange={(e) => set('address', e.target.value)} className={field} />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className={label}>City</span>
                <input value={city} onChange={(e) => set('city', e.target.value)} className={field} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className={label}>State</span>
                <input value={state} onChange={(e) => set('state', e.target.value)} className={field} />
              </label>
            </div>

            <label className="flex flex-col gap-1.5">
              <span className={label}>Pincode</span>
              <input
                value={pincode}
                onChange={(e) => set('pincode', e.target.value.replace(/[^0-9]/g, ''))}
                inputMode="numeric"
                className={field}
              />
            </label>
          </section>
        </>
      )}

      <SaveBar
        visible={dirty}
        pending={updateMutation.isPending}
        onSave={save}
        onDiscard={() => baseline && setFields(baseline)}
        label="Save changes"
      />
    </div>
  );
}
