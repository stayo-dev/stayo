import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle, BookOpen, Car, Check, Clock, Droplets, Dumbbell, ExternalLink, ImagePlus, Lock,
  MapPin, Plus, ShieldCheck, Shirt, Snowflake, Sparkles, Star, Tag, Trash2, Utensils, Wifi, X, Zap,
} from 'lucide-react';

import { stayoToast } from '@shared/ui-patterns/Toast';
import {
  useMarketingEditor,
  useSaveMarketingDraft,
  useSubmitMarketing,
  useWithdrawMarketing,
} from '@features/hostel-marketing/hooks/useMarketing';
import {
  EMPTY_MARKETING_CONTENT,
  type MarketingBed,
  type MarketingContent,
  type MarketingPlace,
  type PlaceCategory,
  type RevisionStatus,
} from '@features/hostel-marketing/api';

/**
 * Hostel Drill-down → Marketing, per the `HOSTEL: MARKETING` section of
 * `Stayo App.dc.html` (lines 1647–1798) and its five edit modals.
 *
 * One deliberate departure from the design: its primary action is
 * **"Save & publish"**, and here nothing publishes on an owner's say-so. The
 * button submits for review, and the status pill carries the real revision
 * state instead of a simple on/off — because a listing an admin has not seen
 * must never be reachable from Discovery.
 *
 * The design's "Switch / reuse" and "Save as new" template controls render
 * disabled: one marketing page per hostel for now. Reuse across hostels
 * changes the approval story materially (one edit re-opens review for every
 * hostel pointing at the page) and is its own piece of work.
 */

const STATUS_META: Record<RevisionStatus, { label: string; className: string }> = {
  DRAFT: { label: 'Draft', className: 'bg-muted text-muted-foreground' },
  PENDING_REVIEW: { label: 'In review', className: 'bg-amber-100 text-amber-800' },
  APPROVED: { label: 'Live', className: 'bg-emerald-100 text-emerald-700' },
  REJECTED: { label: 'Changes requested', className: 'bg-rose-100 text-rose-700' },
  SUPERSEDED: { label: 'Replaced', className: 'bg-muted text-muted-foreground' },
};

/**
 * The design's amenity chips each carry an icon. Rather than storing a glyph
 * per amenity, the label is matched to one — so a custom amenity an owner
 * types still gets a sensible mark instead of a blank space, and the mapping
 * can grow without a migration.
 */
const AMENITY_ICONS: { match: RegExp; Icon: typeof Wifi }[] = [
  { match: /wi-?fi|internet/i, Icon: Wifi },
  { match: /meal|food|mess|dining/i, Icon: Utensils },
  { match: /laundry|washing/i, Icon: Shirt },
  { match: /power|backup|generator/i, Icon: Zap },
  { match: /study|desk|library/i, Icon: BookOpen },
  { match: /housekeep|clean/i, Icon: Sparkles },
  { match: /cctv|security|guard|safe/i, Icon: ShieldCheck },
  { match: /water|ro\b/i, Icon: Droplets },
  { match: /ac\b|air.?con|cooling/i, Icon: Snowflake },
  { match: /parking|bike|car/i, Icon: Car },
  { match: /gym|fitness/i, Icon: Dumbbell },
];

function amenityIcon(label: string) {
  return AMENITY_ICONS.find((entry) => entry.match.test(label))?.Icon ?? Tag;
}

const AMENITY_SUGGESTIONS = [
  '3 meals / day', 'High-speed Wi-Fi', 'Free laundry', 'Power backup', 'Study desk',
  'Housekeeping', 'CCTV security', 'RO water', 'AC rooms', 'Parking',
];

const PLACE_CATEGORIES: { value: PlaceCategory; label: string }[] = [
  { value: 'COLLEGE', label: 'College' },
  { value: 'TRANSPORT', label: 'Transport' },
  { value: 'MARKET', label: 'Market' },
  { value: 'HOSPITAL', label: 'Hospital' },
  { value: 'OTHER', label: 'Other' },
];

export function HostelMarketingPage() {
  const { hostelId } = useParams<{ hostelId: string }>();
  const { data, isLoading } = useMarketingEditor(hostelId);
  const save = useSaveMarketingDraft(hostelId);
  const submit = useSubmitMarketing(hostelId);
  const withdraw = useWithdrawMarketing(hostelId);

  const [content, setContent] = useState<MarketingContent>(EMPTY_MARKETING_CONTENT);
  const [dirty, setDirty] = useState(false);

  // Server state seeds the editor, but must not clobber unsaved edits — a
  // background refetch mid-typing would otherwise silently discard them.
  useEffect(() => {
    if (data?.draft.content && !dirty) setContent(data.draft.content);
  }, [data?.draft.content, dirty]);

  const status = data?.draft.status ?? 'DRAFT';
  const locked = !(data?.is_editable ?? true);
  const meta = STATUS_META[status];

  const patch = (next: Partial<MarketingContent>) => {
    setContent((current) => ({ ...current, ...next }));
    setDirty(true);
  };

  const issues = useMemo(() => {
    const list: string[] = [];
    if (content.photos.length === 0) list.push('Add at least one photo');
    if (content.beds.length === 0) list.push('Add at least one bed type');
    if (content.beds.some((bed) => bed.price <= 0)) list.push('Every bed type needs a price');
    if (!content.basics.tagline?.trim()) list.push('Add a one-line tagline');
    return list;
  }, [content]);

  const onSave = () =>
    save.mutate(content, {
      onSuccess: () => {
        setDirty(false);
        stayoToast.success('Saved');
      },
      onError: (error: any) => stayoToast.error(error?.response?.data?.message ?? 'Could not save'),
    });

  const onSubmit = () => {
    if (dirty) {
      stayoToast.info('Save your changes first');
      return;
    }
    submit.mutate(undefined, {
      onSuccess: () => stayoToast.success('Sent to Stayo for review'),
      onError: (error: any) => stayoToast.error(error?.response?.data?.message ?? 'Could not submit'),
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-3 p-5">
        <div className="h-28 animate-pulse rounded-2xl bg-muted" />
        <div className="h-40 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3.5 px-5 pb-28 pt-3.5">
      {/* ── Status ─────────────────────────────────────────────────────── */}
      <section className="rounded-[20px] bg-[#2A2521] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-[15px] font-bold text-white">Discovery listing</h2>
            <p className="mt-1 max-w-[210px] text-[12px] text-[#B9AFA3]">
              What tenants see when they find this hostel on Stayo
            </p>
          </div>
          <span className={`flex-none rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em] ${meta.className}`}>
            {meta.label}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-5 border-t border-white/10 pt-3">
          <div>
            <p className="font-display text-[17px] font-extrabold tabular-nums text-white">
              {data?.stats.enquiries_30d ?? 0}
            </p>
            <p className="text-[10.5px] text-[#8C8177]">enquiries · 30d</p>
          </div>
          {/* The design also shows a views counter. Stayo does not track
              listing views anywhere, so rather than print a plausible number
              the stat is left out until there is something real behind it. */}
          {data?.published?.version && (
            <a
              href={data.hostel.public_slug ? `/discover/h/${data.hostel.public_slug}` : undefined}
              target="_blank"
              rel="noreferrer"
              className="ml-auto flex items-center gap-1.5 rounded-[10px] bg-white/10 px-3 py-2 font-display text-[12px] font-bold text-white"
            >
              Preview <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
            </a>
          )}
        </div>

        {data?.published && (
          <p className="mt-2.5 text-[11.5px] text-[#8C8177]">
            v{data.published.version} is live now
            {status === 'DRAFT' && dirty ? ' · you have unsaved changes' : ''}
            {status === 'PENDING_REVIEW' ? ' · your new version is being reviewed' : ''}
          </p>
        )}
      </section>

      {/* Changes requested — the owner's route forward */}
      {data?.last_rejection?.review_note && (
        <section className="flex gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none text-rose-600" strokeWidth={2} />
          <div>
            <p className="text-[13px] font-bold text-rose-800">Stayo asked for changes</p>
            <p className="mt-1 text-[12.5px] leading-[1.5] text-rose-700">{data.last_rejection.review_note}</p>
          </div>
        </section>
      )}

      {locked && (
        <section className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <Clock className="h-4 w-4 flex-none text-amber-700" strokeWidth={2} />
          <p className="flex-1 text-[12.5px] text-amber-800">
            Stayo is reviewing this listing, so it's locked. Withdraw it if you need to make changes.
          </p>
          <button
            type="button"
            onClick={() => withdraw.mutate()}
            className="flex-none rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-[12px] font-bold text-amber-800"
          >
            Withdraw
          </button>
        </section>
      )}

      {/* ── Template (deferred, shown honestly) ─────────────────────────── */}
      <section className="rounded-[18px] border border-border bg-card p-4">
        <p className="text-[13.5px] font-bold text-foreground">This hostel's own listing page</p>
        <p className="mt-1 text-[11.5px] leading-[1.5] text-muted-foreground">
          Reusing one page across several hostels is coming — for now each hostel has its own.
        </p>
        <div className="mt-3 flex gap-2">
          <button type="button" disabled aria-disabled className="flex-1 cursor-not-allowed rounded-[11px] border-[1.5px] border-border py-2.5 text-[12.5px] font-bold text-muted-foreground opacity-60">
            Switch / reuse
          </button>
          <button type="button" disabled aria-disabled className="flex-1 cursor-not-allowed rounded-[11px] border-[1.5px] border-border py-2.5 text-[12.5px] font-bold text-muted-foreground opacity-60">
            Save as new
          </button>
        </div>
      </section>

      {/* ── Basics ─────────────────────────────────────────────────────── */}
      <Card title="Basics">
        <div className="space-y-3 px-4 pb-4">
          <Field label="Tagline" hint="One line under your hostel name in search">
            <input
              value={content.basics.tagline ?? ''}
              disabled={locked}
              maxLength={120}
              onChange={(e) => patch({ basics: { ...content.basics, tagline: e.target.value } })}
              placeholder="Walk to campus, meals included"
              className="w-full rounded-[11px] border border-border bg-muted px-3.5 py-2.5 text-[13.5px] font-medium text-foreground outline-none focus:border-primary disabled:opacity-60"
            />
          </Field>
          <Field label="About" hint="A short paragraph — what makes this place good to live in">
            <textarea
              value={content.basics.about ?? ''}
              disabled={locked}
              rows={3}
              maxLength={2000}
              onChange={(e) => patch({ basics: { ...content.basics, about: e.target.value } })}
              className="w-full resize-none rounded-[11px] border border-border bg-muted px-3.5 py-2.5 text-[13.5px] text-foreground outline-none focus:border-primary disabled:opacity-60"
            />
          </Field>
        </div>
      </Card>

      {/* ── Photos ─────────────────────────────────────────────────────── */}
      <Card title="Photos" subtitle={`${content.photos.length} · the cover shows first in search`}>
        <div className="flex gap-2.5 overflow-x-auto px-4 pb-4">
          {content.photos.map((photo, index) => (
            <div key={`${photo.url}-${index}`} className="relative h-[126px] w-[104px] flex-none overflow-hidden rounded-[13px] bg-muted">
              <img src={photo.url} alt={photo.label ?? ''} className="h-full w-full object-cover" />
              {photo.is_cover && (
                <span className="absolute left-1.5 top-1.5 rounded-md bg-[#2A2521] px-1.5 py-0.5 text-[9px] font-bold tracking-wide text-white">
                  COVER
                </span>
              )}
              {!locked && (
                <div className="absolute right-1.5 top-1.5 flex gap-1">
                  <button
                    type="button"
                    aria-label={photo.is_cover ? 'Already the cover' : 'Set as cover'}
                    disabled={photo.is_cover}
                    onClick={() =>
                      patch({ photos: content.photos.map((p, i) => ({ ...p, is_cover: i === index })) })
                    }
                    className="flex h-6 w-6 items-center justify-center rounded-md bg-white/90 disabled:opacity-50"
                  >
                    <Star
                      className="h-3 w-3 text-primary"
                      strokeWidth={2}
                      fill={photo.is_cover ? 'currentColor' : 'none'}
                    />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove photo"
                    onClick={() => patch({ photos: content.photos.filter((_, i) => i !== index) })}
                    className="flex h-6 w-6 items-center justify-center rounded-md bg-white/90"
                  >
                    <Trash2 className="h-3 w-3 text-rose-600" strokeWidth={2} />
                  </button>
                </div>
              )}
              {/* The design captions every photo ("Building", "Common area").
                  Editable in place rather than behind a modal — one field is
                  not worth a sheet. */}
              <input
                value={photo.label ?? ''}
                disabled={locked}
                placeholder="Caption"
                onChange={(e) =>
                  patch({
                    photos: content.photos.map((p, i) => (i === index ? { ...p, label: e.target.value } : p)),
                  })
                }
                className="absolute inset-x-0 bottom-0 border-0 bg-gradient-to-t from-black/70 to-transparent px-2 py-1.5 text-[10.5px] font-semibold text-white placeholder:text-white/60 outline-none"
              />
            </div>
          ))}
          <AddPhotoTile
            disabled={locked}
            onAdd={(url) =>
              patch({
                photos: [
                  ...content.photos,
                  { url, label: null, is_cover: content.photos.length === 0, sort: content.photos.length },
                ],
              })
            }
          />
        </div>
      </Card>

      {/* ── Beds & pricing ─────────────────────────────────────────────── */}
      <Card
        title="Beds & pricing"
        subtitle="sharing types tenants can request"
        action={
          !locked && (
            <AddButton
              onClick={() =>
                patch({
                  beds: [...content.beds, { name: '', sharing: 4, price: 0, inclusions: null, availability: 'BEDS_LEFT' }],
                })
              }
            />
          )
        }
      >
        <div className="space-y-2.5 px-4 pb-4">
          {content.beds.length === 0 && <Empty>No bed types yet. Tenants can't request a bed you haven't listed.</Empty>}
          {content.beds.map((bed, index) => (
            <BedRow
              key={index}
              bed={bed}
              disabled={locked}
              onChange={(next) => patch({ beds: content.beds.map((b, i) => (i === index ? next : b)) })}
              onRemove={() => patch({ beds: content.beds.filter((_, i) => i !== index) })}
            />
          ))}
        </div>
      </Card>

      {/* ── Amenities ──────────────────────────────────────────────────── */}
      <Card title="What this hostel offers" subtitle={`${content.amenities.filter((a) => a.enabled).length} on`}>
        <div className="px-4 pb-4">
          <p className="mb-3 text-[11px] text-muted-foreground">Tap to show or hide on the listing</p>
          <div className="flex flex-wrap gap-2">
            {content.amenities.map((amenity, index) => {
              const Icon = amenityIcon(amenity.label);
              return (
                <button
                  key={`${amenity.label}-${index}`}
                  type="button"
                  disabled={locked}
                  aria-pressed={amenity.enabled}
                  onClick={() =>
                    patch({
                      amenities: content.amenities.map((a, i) => (i === index ? { ...a, enabled: !a.enabled } : a)),
                    })
                  }
                  className={`flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-[12px] font-semibold transition-colors ${
                    amenity.enabled
                      ? 'border-primary/60 bg-card text-primary'
                      : 'border-border bg-card text-muted-foreground'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
                  {amenity.label}
                </button>
              );
            })}
            {!locked && (
              <AddAmenity
                existing={content.amenities.map((a) => a.label)}
                suggestions={AMENITY_SUGGESTIONS}
                onAdd={(label) => patch({ amenities: [...content.amenities, { label, enabled: true, icon: null }] })}
              />
            )}
          </div>
        </div>
      </Card>

      {/* ── Getting around ─────────────────────────────────────────────── */}
      <Card
        title="Getting around"
        subtitle="nearby places"
        action={
          !locked && (
            <AddButton
              onClick={() =>
                patch({
                  places: [...content.places, { name: '', distance: '', category: 'OTHER', sort: content.places.length }],
                })
              }
            />
          )
        }
      >
        <div className="space-y-2.5 px-4 pb-4">
          {content.places.length === 0 && <Empty>Add a college, metro or market so tenants can place you.</Empty>}
          {content.places.map((place, index) => (
            <PlaceRow
              key={index}
              place={place}
              disabled={locked}
              onChange={(next) => patch({ places: content.places.map((p, i) => (i === index ? next : p)) })}
              onRemove={() => patch({ places: content.places.filter((_, i) => i !== index) })}
            />
          ))}
        </div>
      </Card>

      {/* ── Reviews: locked by design ──────────────────────────────────── */}
      <section className="rounded-[18px] border border-border bg-muted p-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[10px] bg-card">
            <Lock className="h-4 w-4 text-muted-foreground" strokeWidth={1.9} />
          </span>
          <div>
            <p className="text-[13.5px] font-bold text-foreground">Resident reviews</p>
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Managed by Stayo</p>
          </div>
        </div>
        <p className="mt-2.5 text-[11.5px] leading-[1.6] text-muted-foreground">
          Residents review your hostel through Stayo. To keep them trustworthy, owners can't add, edit or remove
          reviews. Reviews aren't collected yet — when they are, they'll appear here and on your listing.
        </p>
      </section>

      {/* ── Save / submit bar ──────────────────────────────────────────── */}
      {!locked && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2.5 border-t border-border bg-card/95 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
          <button
            type="button"
            onClick={onSave}
            disabled={!dirty || save.isPending}
            className="flex-none rounded-[13px] border-[1.5px] border-border px-4 py-3 font-display text-[13px] font-bold text-foreground disabled:opacity-50"
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={issues.length > 0 || submit.isPending}
            title={issues[0]}
            className="flex-1 rounded-[13px] bg-primary py-3 font-display text-[13.5px] font-bold text-primary-foreground disabled:opacity-50"
          >
            {issues.length > 0 ? issues[0] : submit.isPending ? 'Sending…' : 'Send to Stayo for review'}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── small building blocks ─────────────────────────────────────────────── */

function Card({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[18px] border border-border bg-card">
      <header className="flex items-center justify-between px-4 pb-3 pt-4">
        <div className="flex items-baseline gap-2">
          <h3 className="font-display text-[14px] font-bold text-foreground">{title}</h3>
          {subtitle && <span className="text-[11.5px] text-muted-foreground">{subtitle}</span>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl bg-muted px-3.5 py-3 text-[12px] text-muted-foreground">{children}</p>;
}

function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 rounded-[9px] bg-[#2A2521] px-2.5 py-1.5 font-display text-[11.5px] font-bold text-white"
    >
      <Plus className="h-3 w-3" strokeWidth={2.5} /> Add
    </button>
  );
}

/**
 * Photos are added by URL rather than uploaded here.
 *
 * ImageKit upload already exists elsewhere in this app (profile photos,
 * documents) and wiring it in is real work; a URL field is the honest interim
 * — it stores exactly what the listing will render, rather than pretending an
 * upload happened.
 */
function AddPhotoTile({ disabled, onAdd }: { disabled: boolean; onAdd: (url: string) => void }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');

  if (disabled) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex h-[126px] w-[104px] flex-none flex-col items-center justify-center gap-1.5 rounded-[13px] border-[1.5px] border-dashed border-border bg-muted text-primary"
      >
        <ImagePlus className="h-5 w-5" strokeWidth={1.8} />
        <span className="font-display text-[11px] font-bold">Add</span>
      </button>
    );
  }

  return (
    <div className="flex h-[126px] w-[190px] flex-none flex-col gap-2 rounded-[13px] border border-border bg-card p-2.5">
      <input
        autoFocus
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="https://…"
        className="w-full rounded-lg border border-border bg-muted px-2 py-1.5 text-[12px] outline-none focus:border-primary"
      />
      <div className="mt-auto flex gap-1.5">
        <button
          type="button"
          onClick={() => {
            const trimmed = url.trim();
            if (!trimmed) return;
            onAdd(trimmed);
            setUrl('');
            setOpen(false);
          }}
          className="flex-1 rounded-lg bg-primary py-1.5 text-[11.5px] font-bold text-primary-foreground"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setUrl(''); }}
          className="rounded-lg border border-border px-2 py-1.5 text-[11.5px] font-semibold text-muted-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

function AddAmenity({
  existing,
  suggestions,
  onAdd,
}: {
  existing: string[];
  suggestions: string[];
  onAdd: (label: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const remaining = suggestions.filter((s) => !existing.includes(s));

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-[10px] border border-dashed border-primary/50 px-3 py-2 font-display text-[12px] font-bold text-primary"
      >
        + Add amenity
      </button>
    );
  }

  return (
    <div className="w-full rounded-xl border border-border bg-muted p-3">
      <div className="flex gap-2">
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. Rooftop lounge"
          className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-[13px] outline-none focus:border-primary"
        />
        <button
          type="button"
          onClick={() => {
            const trimmed = value.trim();
            if (!trimmed) return;
            onAdd(trimmed);
            setValue('');
            setOpen(false);
          }}
          className="rounded-lg bg-primary px-3 py-2 text-[12.5px] font-bold text-primary-foreground"
        >
          Add
        </button>
      </div>
      {remaining.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {remaining.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => { onAdd(suggestion); setOpen(false); }}
              className="rounded-lg border border-border bg-card px-2.5 py-1.5 text-[11.5px] font-semibold text-foreground"
            >
              + {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BedRow({
  bed,
  disabled,
  onChange,
  onRemove,
}: {
  bed: MarketingBed;
  disabled: boolean;
  onChange: (next: MarketingBed) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted p-3">
      <div className="flex gap-2">
        <input
          value={bed.name}
          disabled={disabled}
          placeholder="4-Bed AC"
          onChange={(e) => onChange({ ...bed, name: e.target.value })}
          className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-[13px] font-semibold outline-none focus:border-primary disabled:opacity-60"
        />
        {!disabled && (
          <button type="button" aria-label="Remove bed type" onClick={onRemove} className="flex-none px-1.5 text-rose-600">
            <Trash2 className="h-4 w-4" strokeWidth={2} />
          </button>
        )}
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">Sharing</span>
          <input
            type="number"
            min={1}
            max={20}
            value={bed.sharing}
            disabled={disabled}
            onChange={(e) => onChange({ ...bed, sharing: Number(e.target.value) || 1 })}
            className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] outline-none focus:border-primary disabled:opacity-60"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">₹ / month</span>
          <input
            type="number"
            min={0}
            value={bed.price}
            disabled={disabled}
            onChange={(e) => onChange({ ...bed, price: Number(e.target.value) || 0 })}
            className="w-full rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] outline-none focus:border-primary disabled:opacity-60"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[10px] font-semibold uppercase text-muted-foreground">Availability</span>
          <select
            value={bed.availability}
            disabled={disabled}
            onChange={(e) => onChange({ ...bed, availability: e.target.value as MarketingBed['availability'] })}
            className="w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[12px] outline-none focus:border-primary disabled:opacity-60"
          >
            <option value="BEDS_LEFT">Beds left</option>
            <option value="AVAILABLE">Available</option>
            <option value="FULL">Full</option>
          </select>
        </label>
      </div>
      <input
        value={bed.inclusions ?? ''}
        disabled={disabled}
        placeholder="Attached bath · study desk · locker"
        onChange={(e) => onChange({ ...bed, inclusions: e.target.value })}
        className="mt-2 w-full rounded-lg border border-border bg-card px-3 py-2 text-[12.5px] outline-none focus:border-primary disabled:opacity-60"
      />
    </div>
  );
}

function PlaceRow({
  place,
  disabled,
  onChange,
  onRemove,
}: {
  place: MarketingPlace;
  disabled: boolean;
  onChange: (next: MarketingPlace) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-muted p-2.5">
      <MapPin className="h-4 w-4 flex-none text-muted-foreground" strokeWidth={1.8} />
      <input
        value={place.name}
        disabled={disabled}
        placeholder="Osmania University"
        onChange={(e) => onChange({ ...place, name: e.target.value })}
        className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-[12.5px] outline-none focus:border-primary disabled:opacity-60"
      />
      <input
        value={place.distance}
        disabled={disabled}
        placeholder="400 m"
        onChange={(e) => onChange({ ...place, distance: e.target.value })}
        className="w-[76px] flex-none rounded-lg border border-border bg-card px-2 py-1.5 text-[12.5px] outline-none focus:border-primary disabled:opacity-60"
      />
      <select
        value={place.category}
        disabled={disabled}
        onChange={(e) => onChange({ ...place, category: e.target.value as PlaceCategory })}
        className="w-[92px] flex-none rounded-lg border border-border bg-card px-1.5 py-1.5 text-[11.5px] outline-none focus:border-primary disabled:opacity-60"
      >
        {PLACE_CATEGORIES.map((category) => (
          <option key={category.value} value={category.value}>{category.label}</option>
        ))}
      </select>
      {!disabled && (
        <button type="button" aria-label="Remove place" onClick={onRemove} className="flex-none text-rose-600">
          <Trash2 className="h-4 w-4" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
