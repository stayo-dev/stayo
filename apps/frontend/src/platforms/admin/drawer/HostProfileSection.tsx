import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hostProfileErrorMessage, hostProfileService } from '@features/host-profile/api';
import { HostCard } from '@features/host-profile/components/HostCard';
import { draftFrom, formatMonthYear, hostingYears, publicView, toggleLanguage } from '@features/host-profile/model/hostCardModel';
import { BIO_MAX_CHARS, HOST_LANGUAGES, type AdminHost, type HostAdminPatch } from '@features/host-profile/model/types';
import { DrawerSection } from './AdminDrawer';

const input = 'w-full rounded-[10px] border border-[#E6DDD2] bg-white px-3 py-2 text-[13px] text-[#221E1A] outline-none focus:border-[#B46A55]';
const small = 'text-[11px] font-semibold text-[#8A7F75]';

/**
 * ADR-200 admin override for an owner's public host card. Owner edits are
 * live on save; this is where Stayo corrects the name, edits the words,
 * replaces the photo, or hides the bio/photo. A hide survives later owner
 * edits until it is lifted here. The preview is the public `HostCard`, with
 * hides applied, so the admin sees exactly what residents see.
 */
export function HostProfileSection({ ownerId }: { ownerId: string }) {
  const queryClient = useQueryClient();
  const key = ['admin', 'owner', ownerId, 'host-profile'];
  const query = useQuery({ queryKey: key, queryFn: () => hostProfileService.getForOwner(ownerId), staleTime: 30_000 });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<{ name: string; bio: string; languages: string[]; hosting_since: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = (data?: AdminHost) => {
    if (data) queryClient.setQueryData(key, data);
    else queryClient.invalidateQueries({ queryKey: key });
    // The drawer's owner detail shows the account name an admin may just have corrected.
    queryClient.invalidateQueries({ queryKey: ['admin', 'owner', ownerId], exact: true });
  };

  const patch = useMutation({
    mutationFn: (body: HostAdminPatch) => hostProfileService.updateForOwner(ownerId, body),
    onSuccess: (data) => {
      refresh(data);
      setError(null);
      setEditing(false);
    },
    onError: (e) => setError(hostProfileErrorMessage(e, 'Could not update this host profile')),
  });
  const replacePhoto = useMutation({
    mutationFn: (file: File) => hostProfileService.replaceOwnerPhoto(ownerId, file),
    onSuccess: () => refresh(),
    onError: (e) => setError(hostProfileErrorMessage(e, 'Could not upload that photo')),
  });
  const removePhoto = useMutation({
    mutationFn: () => hostProfileService.removeOwnerPhoto(ownerId),
    onSuccess: () => refresh(),
    onError: (e) => setError(hostProfileErrorMessage(e, 'Could not remove the photo')),
  });

  const host = query.data;

  const startEdit = () => {
    if (!host) return;
    setForm({ name: host.name ?? '', ...draftFrom(host) });
    setError(null);
    setEditing(true);
  };

  const toggle = (flag: 'bio_hidden' | 'photo_hidden') => host && patch.mutate({ [flag]: !host[flag] });

  return (
    <DrawerSection
      title="Public host profile"
      action={
        host && !editing ? (
          <button type="button" onClick={startEdit} className="text-[11px] font-semibold text-[#B46A55]">Edit</button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 px-[18px] py-4">
        {query.isLoading && <p className="text-[12px] text-[#8A7F75]">Loading host profile…</p>}
        {query.isError && <p className="text-[12px] text-[#B3402F]">Couldn't load this host profile.</p>}

        {host && (
          <>
            <div className="rounded-2xl bg-[#F7F1EC] p-4">
              <HostCard host={publicView(host)} />
            </div>

            {editing && form ? (
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                  <span className={small}>Name (the owner's account name)</span>
                  <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={small}>Story · {form.bio.length} / {BIO_MAX_CHARS}</span>
                  <textarea
                    className={`${input} resize-y`}
                    rows={5}
                    maxLength={BIO_MAX_CHARS}
                    value={form.bio}
                    onChange={(e) => setForm({ ...form, bio: e.target.value })}
                  />
                </label>
                <div className="flex flex-col gap-1">
                  <span className={small}>Languages</span>
                  <div className="flex flex-wrap gap-1.5">
                    {HOST_LANGUAGES.map((language) => {
                      const on = form.languages.includes(language);
                      return (
                        <button
                          key={language}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setForm({ ...form, languages: toggleLanguage(form.languages, language) })}
                          className={`rounded-full border px-2.5 py-1 text-[11.5px] ${on ? 'border-[#221E1A] bg-[#221E1A] text-white' : 'border-[#E6DDD2] bg-white text-[#221E1A]'}`}
                        >
                          {language}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <label className="flex flex-col gap-1">
                  <span className={small}>Running hostels since</span>
                  <select
                    className={input}
                    value={form.hosting_since ?? ''}
                    onChange={(e) => setForm({ ...form, hosting_since: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">Not set</option>
                    {hostingYears().map((year) => <option key={year} value={year}>{year}</option>)}
                  </select>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={patch.isPending}
                    onClick={() => patch.mutate(form)}
                    className="rounded-[10px] bg-[#221E1A] px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-60"
                  >
                    {patch.isPending ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" onClick={() => setEditing(false)} className="rounded-[10px] border border-[#E6DDD2] px-4 py-2 text-[12.5px] font-semibold text-[#4A433C]">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                <label className="flex items-center justify-between gap-3 text-[12.5px] text-[#2A2521]">
                  Hide bio from public listing
                  <input type="checkbox" checked={host.bio_hidden} disabled={patch.isPending} onChange={() => toggle('bio_hidden')} />
                </label>
                <label className="flex items-center justify-between gap-3 text-[12.5px] text-[#2A2521]">
                  Hide photo from public listing
                  <input type="checkbox" checked={host.photo_hidden} disabled={patch.isPending} onChange={() => toggle('photo_hidden')} />
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    disabled={replacePhoto.isPending}
                    className="rounded-[10px] border border-[#E6DDD2] px-3 py-1.5 text-[12px] font-semibold text-[#4A433C]"
                  >
                    {replacePhoto.isPending ? 'Uploading…' : 'Replace photo'}
                  </button>
                  {host.photo_url && (
                    <button
                      type="button"
                      onClick={() => removePhoto.mutate()}
                      disabled={removePhoto.isPending}
                      className="rounded-[10px] border border-[#E6DDD2] px-3 py-1.5 text-[12px] font-semibold text-[#B3402F]"
                    >
                      Remove photo
                    </button>
                  )}
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) replacePhoto.mutate(file);
                      e.target.value = '';
                    }}
                  />
                </div>
                {host.updated_at && (
                  <p className="text-[11px] text-[#9A8F84]">
                    Last edited{host.updated_by_name ? ` by ${host.updated_by_name}` : ''}, {formatMonthYear(host.updated_at)}
                  </p>
                )}
              </div>
            )}

            {error && <p className="text-[12px] font-medium text-[#B3402F]">{error}</p>}
          </>
        )}
      </div>
    </DrawerSection>
  );
}
