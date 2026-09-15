import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { queryKeys } from '@lib/queryKeys';
import { MoreScreenHeader } from '@features/owner-more/components/MoreScreenHeader';
import { SaveBar } from '@features/owner-more/components/SaveBar';
import { hasChanges } from '@features/owner-more/config/dirtyState';
import { hostProfileErrorMessage, hostProfileService } from '../api';
import { HostCard } from '../components/HostCard';
import {
  buildMilestones, draftFrom, hiddenNotice, hostingYears, publicView, toggleLanguage, withDraft,
} from '../model/hostCardModel';
import { BIO_MAX_CHARS, HOST_LANGUAGES, type HostDraft } from '../model/types';

const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const field =
  'w-full rounded-[11px] border border-border bg-card px-3.5 py-2.5 text-[14px] text-foreground outline-none focus:border-primary';

/**
 * Profile → Your host profile (ADR-200).
 *
 * Not a form field on Details. An owner's story is the one thing on their
 * account a resident reads, so it gets a screen that opens on what they have
 * earned (the milestones) and shows them — live, as they type — exactly the
 * card a resident will see. The preview is `HostCard` itself, fed through
 * `publicView`, so an admin hide shows here the way it shows on Discover.
 *
 * Saves live (no approval queue). The photo is changed on Details; this
 * screen links there rather than growing a second uploader.
 */
export function HostProfilePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.owner.hostProfile(),
    queryFn: hostProfileService.getMine,
    staleTime: 60_000,
  });

  const [draft, setDraft] = useState<HostDraft>({ bio: '', languages: [], hosting_since: null });
  const [baseline, setBaseline] = useState<HostDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      const loaded = draftFrom(query.data);
      setDraft(loaded);
      setBaseline(loaded);
    }
  }, [query.data]);

  const save = useMutation({
    mutationFn: hostProfileService.saveMine,
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.owner.hostProfile(), saved);
      setError(null);
      stayoToast.success('Your host profile is live');
    },
    onError: (e) => setError(hostProfileErrorMessage(e, 'Could not save your host profile')),
  });

  const dirty = hasChanges(baseline, draft);
  const host = query.data;
  const notice = host ? hiddenNotice(host) : null;

  return (
    <div className={`flex flex-col gap-6 px-4 pt-6 sm:px-6 lg:mx-auto lg:w-full lg:max-w-[760px] lg:px-0 lg:pt-8 ${dirty ? 'pb-40' : 'pb-24'}`}>
      <MoreScreenHeader
        backTo="/owner/more"
        backLabel="Profile"
        title="Your host profile"
        subtitle="This is how residents meet you on Stayo."
      />

      {!host ? (
        query.isError ? (
          <p className="text-[13px] text-destructive">Couldn't load your host profile. Please try again.</p>
        ) : (
          <div className="h-64 animate-pulse rounded-2xl bg-muted" />
        )
      ) : (
        <>
          <section className="grid grid-cols-3 gap-2">
            {buildMilestones(host).map((m) => (
              <div key={m.key} className="rounded-[14px] border border-border bg-card px-2 py-3 text-center">
                {m.value ? (
                  <>
                    <p className="font-display text-[17px] font-extrabold text-foreground">{m.value}</p>
                    <p className="mt-0.5 text-[10.5px] leading-tight text-muted-foreground">{m.label}</p>
                  </>
                ) : (
                  <p className="text-[10.5px] leading-tight text-muted-foreground">{m.label}</p>
                )}
              </div>
            ))}
          </section>

          {notice && (
            <p className="rounded-[12px] border border-border bg-muted px-3.5 py-3 text-[12.5px] leading-[1.5] text-foreground">
              {notice}
            </p>
          )}

          <section className="flex flex-col gap-2">
            <h2 className={sectionLabel}>Live preview</h2>
            <div className="rounded-[18px] bg-[#F7F1EC] p-4">
              <HostCard host={publicView(withDraft(host, draft))} />
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className={sectionLabel}>Your story</h2>
            <p className="rounded-[10px] bg-primary/10 px-3 py-2 text-[12px] leading-[1.5] text-primary">
              Not sure what to write? Try: why you started your hostel · what you do for residents · where to find you.
            </p>
            <textarea
              value={draft.bio}
              onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))}
              maxLength={BIO_MAX_CHARS}
              rows={6}
              className={`${field} resize-y leading-[1.55]`}
              aria-label="Your story"
              aria-describedby="host-bio-help"
            />
            <p id="host-bio-help" className="flex justify-between gap-3 px-0.5 text-[11px] text-muted-foreground">
              <span>No phone numbers or links — residents reach you through Stayo.</span>
              <span className="flex-none tabular-nums">{draft.bio.length} / {BIO_MAX_CHARS}</span>
            </p>
            {error && <p className="px-0.5 text-[12px] font-medium text-destructive">{error}</p>}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className={sectionLabel}>Languages you speak</h2>
            <div className="flex flex-wrap gap-2">
              {HOST_LANGUAGES.map((language) => {
                const on = draft.languages.includes(language);
                return (
                  <button
                    key={language}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setDraft((d) => ({ ...d, languages: toggleLanguage(d.languages, language) }))}
                    className={`rounded-full border px-3 py-1.5 text-[12.5px] font-medium ${
                      on ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-foreground'
                    }`}
                  >
                    {language}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className={sectionLabel}>Running hostels since</h2>
            <select
              value={draft.hosting_since ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, hosting_since: e.target.value ? Number(e.target.value) : null }))}
              className={field}
              aria-label="Running hostels since"
            >
              <option value="">Not set</option>
              {hostingYears().map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </section>

          <section className="flex items-center justify-between gap-3 rounded-[14px] border border-border bg-card px-4 py-3">
            <span className="text-[13px] text-muted-foreground">Your photo comes from your Details.</span>
            <button
              type="button"
              onClick={() => navigate('/owner/more/profile')}
              className="flex-none text-[13px] font-semibold text-primary"
            >
              Change photo
            </button>
          </section>
        </>
      )}

      <SaveBar
        visible={dirty}
        pending={save.isPending}
        onSave={() => save.mutate(draft)}
        onDiscard={() => baseline && setDraft(baseline)}
        label="Save"
      />
    </div>
  );
}
