import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AlertTriangle, BedDouble, ChevronRight, Clock, FileText, GripVertical, ImagePlus, Lock, Plus,
  Share2, Star,
} from 'lucide-react';

import { stayoToast } from '@shared/ui-patterns/Toast';
import { useShareHostel } from '@shared/hooks/useShareHostel';
import { LIFECYCLE_STEPS, listingLifecycle, primaryActionLabel } from '../marketing/listingLifecycle';
import {
  useMarketingEditor,
  useSaveMarketingDraft,
  useSubmitMarketing,
  useWithdrawMarketing,
} from '@features/hostel-marketing/hooks/useMarketing';
import {
  EMPTY_MARKETING_CONTENT,
  MESS_TYPE_LABELS,
  type MarketingBed,
  type MarketingContent,
  type MarketingPlace,
  type MessType,
  type RevisionStatus,
} from '@features/hostel-marketing/api';

import { AmenitySheet } from '../marketing/AmenitySheet';
import { BasicsSheet } from '../marketing/BasicsSheet';
import { BedSheet } from '../marketing/BedSheet';
import { MEAL_ICON, MessMenuSheet } from '../marketing/MessMenuSheet';
import { PhotosScreen } from '../marketing/PhotosScreen';
import { PlaceSheet, placeIcon } from '../marketing/PlaceSheet';
import { PreviewScreen } from '../marketing/PreviewScreen';
import { TemplateSheet } from '../marketing/TemplateSheet';
import { amenityIcon } from '../marketing/amenityIcons';
import { CARD_SHADOW, M, MESS_DAY_LABELS } from '../marketing/marketingTheme';

/**
 * Hostel Drill-down → Marketing, rebuilt from the `HOSTEL: MARKETING` section
 * of `Stayo App.dc.html` (lines 1648–1835) and its seven modals.
 *
 * Two deliberate departures, both about not saying things that aren't true:
 *
 * 1. The design's status toggle publishes a listing on the owner's say-so.
 *    Here it submits for review and the caps label carries the real revision
 *    state — a listing an admin has not seen must never be reachable from
 *    Discovery. The card, toggle and label are the design's, the action is not.
 * 2. The design prints `1,240 views · 30d` and `★ 4.8 · 126 resident reviews`.
 *    Stayo tracks no listing views and collects no reviews yet, so both slots
 *    render in place with what is real: the true enquiry count, an em dash for
 *    views, and a review card that says none have come in.
 */

/**
 * Colours for the six real states of a listing (see `listingLifecycle`), not
 * for the five revision statuses. The two are not the same thing: after
 * approval there is no open revision at all, so a status-keyed badge said
 * "Draft" about a listing that was live.
 */
const LIFECYCLE_COLOR: Record<string, string> = {
  DRAFT: '#B9AFA3',
  IN_REVIEW: '#E0B776',
  LIVE_IN_REVIEW: '#E0B776',
  LIVE: '#7FCBA1',
  LIVE_EDITED: '#E0B776',
  CHANGES_REQUESTED: '#E59D8E',
};

const MESS_TYPES: MessType[] = ['VEG', 'NON_VEG', 'BOTH'];

/** Which sheet is open. One at a time, as the design's stacking implies. */
type Sheet =
  | { kind: 'none' }
  | { kind: 'template' }
  | { kind: 'basics'; field: 'tagline' | 'about' }
  | { kind: 'amenity' }
  | { kind: 'bed'; index: number }
  | { kind: 'place'; index: number }
  | { kind: 'mess' }
  | { kind: 'photos' }
  | { kind: 'preview' };

const NEW_BED: MarketingBed = {
  name: '',
  sharing: 4,
  price: 0,
  inclusions: null,
  availability: 'BEDS_LEFT',
};

export function HostelMarketingPage() {
  const { hostelId } = useParams<{ hostelId: string }>();
  const { data, isLoading } = useMarketingEditor(hostelId);
  const save = useSaveMarketingDraft(hostelId);
  const submit = useSubmitMarketing(hostelId);
  const withdraw = useWithdrawMarketing(hostelId);

  const [content, setContent] = useState<MarketingContent>(EMPTY_MARKETING_CONTENT);
  const [dirty, setDirty] = useState(false);
  const [sheet, setSheet] = useState<Sheet>({ kind: 'none' });
  const [messDay, setMessDay] = useState(0);

  // Server state seeds the editor, but must not clobber unsaved edits — a
  // background refetch mid-typing would otherwise silently discard them.
  useEffect(() => {
    if (data?.draft.content && !dirty) setContent(data.draft.content);
  }, [data?.draft.content, dirty]);

  const { share } = useShareHostel();

  /**
   * An owner can only share a listing the public can actually open: an
   * APPROVED revision (`published`) on a hostel that has a public slug. Before
   * that, `/h/:slug` would 404 — better to say so on the button than to hand
   * someone a dead link to send to their tenants.
   */
  const shareSlug = data?.published && data.hostel.public_slug ? data.hostel.public_slug : null;

  const status = data?.draft.status ?? 'DRAFT';
  const locked = !(data?.is_editable ?? true);
  const lifecycle = listingLifecycle(data, dirty);
  const closeSheet = () => setSheet({ kind: 'none' });

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

  const onSave = (options?: { thenSubmit?: boolean }) =>
    save.mutate(content, {
      onSuccess: () => {
        setDirty(false);
        if (!options?.thenSubmit) {
          stayoToast.success('Saved');
          return;
        }
        submit.mutate(undefined, {
          onSuccess: () => stayoToast.success('Sent to Stayo for review'),
          onError: (error: any) =>
            stayoToast.error(error?.response?.data?.message ?? 'Saved, but could not submit'),
        });
      },
      onError: (error: any) => stayoToast.error(error?.response?.data?.message ?? 'Could not save'),
    });

  /**
   * The design's status toggle. Off→on sends the draft for review; on→off
   * withdraws it. Saving first is implicit: submitting a version an owner can
   * see unsaved edits on top of is the bug the old "Save your changes first"
   * toast existed to prevent, and doing it for them is better than refusing.
   */
  const onPrimaryAction = () => {
    if (lifecycle.action === 'WITHDRAW') {
      withdraw.mutate(undefined, {
        onSuccess: () => stayoToast.success('Withdrawn — you can edit again'),
        onError: (error: any) => stayoToast.error(error?.response?.data?.message ?? 'Could not withdraw'),
      });
      return;
    }
    if (issues.length > 0) {
      stayoToast.info(issues[0]);
      return;
    }
    onSave({ thenSubmit: true });
  };

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3.5 px-5 pt-3.5">
        <div className="h-32 animate-pulse rounded-[20px] bg-muted" />
        <div className="h-28 animate-pulse rounded-[18px] bg-muted" />
        <div className="h-44 animate-pulse rounded-[18px] bg-muted" />
      </div>
    );
  }

  const messMealsOn = content.mess.meals.filter((meal) => meal.enabled).length;

  return (
    <>
      <div className="flex flex-col gap-3.5 px-5 pb-32 pt-3.5">
        {/* ── Status ───────────────────────────────────────────────────── */}
        <section className="rounded-[20px] px-[18px] py-4" style={{ background: M.ink }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-col gap-[5px]">
              <h2 className="font-display text-[15px] font-bold text-white">Discovery listing</h2>
              <p className="max-w-[190px] text-[12px]" style={{ color: M.inkText }}>
                What tenants see when they find this hostel on Stayo
              </p>
            </div>
            <span
              className="flex-none rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.06em]"
              style={{ color: LIFECYCLE_COLOR[lifecycle.key], background: 'rgba(255,255,255,.08)' }}
            >
              {lifecycle.label}
            </span>
          </div>

          {/*
            The review cycle, stated. An owner used to get no confirmation that
            a submission had landed anywhere, and a live listing announced
            itself as "Draft" — so nobody could tell whether what they were
            looking at was what the public sees. Three steps, the current one
            lit, and a sentence saying what happens next.
          */}
          <div className="mt-3.5 flex items-center gap-1.5">
            {LIFECYCLE_STEPS.map((label, index) => (
              <div key={label} className="flex flex-1 flex-col gap-1">
                <span
                  className="h-[3px] rounded-full transition-colors"
                  style={{
                    background:
                      index <= lifecycle.step ? LIFECYCLE_COLOR[lifecycle.key] : 'rgba(255,255,255,.14)',
                  }}
                />
                <span
                  className="text-[9.5px] font-bold uppercase tracking-[0.05em]"
                  style={{ color: index === lifecycle.step ? '#fff' : M.inkTextFaint }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>

          <p className="mt-2.5 text-[11.5px] leading-[1.55]" style={{ color: M.inkText }}>
            {lifecycle.detail}
          </p>

          {primaryActionLabel(lifecycle.action) && (
            <button
              type="button"
              onClick={onPrimaryAction}
              disabled={save.isPending || submit.isPending || withdraw.isPending}
              className="mt-3 w-full rounded-[12px] px-4 py-2.5 font-display text-[13px] font-bold transition-opacity disabled:opacity-60"
              style={{
                background: lifecycle.action === 'WITHDRAW' ? 'rgba(255,255,255,.12)' : 'var(--primary)',
                color: '#fff',
              }}
            >
              {save.isPending || submit.isPending
                ? 'Sending…'
                : withdraw.isPending
                  ? 'Withdrawing…'
                  : primaryActionLabel(lifecycle.action)}
            </button>
          )}

          <div className="mt-3 flex gap-5 border-t border-white/[0.08] pt-3">
            <div className="flex flex-col gap-0.5">
              {/* Stayo tracks no listing views. The design's slot stays, with
                  an em dash rather than a plausible-looking number. */}
              <span className="font-display text-[17px] font-extrabold tabular-nums text-white">
                {data?.stats.views_30d ?? '—'}
              </span>
              <span className="text-[10.5px]" style={{ color: M.inkTextFaint }}>
                views · 30d
              </span>
            </div>
            <span className="w-px bg-white/10" />
            <div className="flex flex-col gap-0.5">
              <span className="font-display text-[17px] font-extrabold tabular-nums text-white">
                {data?.stats.enquiries_30d ?? 0}
              </span>
              <span className="text-[10.5px]" style={{ color: M.inkTextFaint }}>
                enquiries
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2 self-center">
              <button
                type="button"
                disabled={!shareSlug}
                onClick={() =>
                  shareSlug && data
                    ? share({ name: data.hostel.name, slug: shareSlug })
                    : undefined
                }
                title={shareSlug ? 'Share this listing' : 'Publish your listing to share it'}
                aria-label={shareSlug ? 'Share this listing' : 'Publish your listing to share it'}
                className="flex items-center gap-1.5 rounded-[10px] bg-white/10 px-3 py-2 font-display text-[12px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Share2 className="h-3.5 w-3.5" strokeWidth={2} />
                Share
              </button>
              <button
                type="button"
                onClick={() => setSheet({ kind: 'preview' })}
                className="rounded-[10px] bg-white/10 px-3 py-2 font-display text-[12px] font-bold text-white"
              >
                Preview
              </button>
            </div>
          </div>


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

        {/* ── Template / reuse ─────────────────────────────────────────── */}
        <Card padded>
          <div className="flex items-center gap-[11px]">
            <span
              className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[11px]"
              style={{ background: M.iconTile, color: 'var(--primary)' }}
            >
              <FileText className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-display text-[13.5px] font-bold text-foreground">
                {data?.hostel.name ?? 'This hostel'}
              </p>
              <p className="text-[11.5px] text-muted-foreground">Its own listing page · v{data?.draft.version ?? 1}</p>
            </div>
          </div>
          <p className="mt-3 text-[11.5px] leading-[1.5] text-muted-foreground">
            One page can be reused across hostels, or draft a separate page per hostel.
          </p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setSheet({ kind: 'template' })}
              className="flex-1 rounded-[11px] border-[1.5px] py-[11px] font-display text-[12.5px] font-bold"
              style={{ borderColor: M.outline, color: M.outlineText }}
            >
              Switch / reuse
            </button>
            <button
              type="button"
              onClick={() => setSheet({ kind: 'template' })}
              className="flex-1 rounded-[11px] border-[1.5px] py-[11px] font-display text-[12.5px] font-bold"
              style={{ borderColor: M.outline, color: M.outlineText }}
            >
              Save as new
            </button>
          </div>
        </Card>

        {/* ── Photos ───────────────────────────────────────────────────── */}
        <Card>
          <CardHeader
            title="Photos"
            subtitle={`${content.photos.length} added`}
            action={
              !locked && (
                <button
                  type="button"
                  onClick={() => setSheet({ kind: 'photos' })}
                  className="font-display text-[12.5px] font-bold text-primary"
                >
                  Manage
                </button>
              )
            }
          />
          <div className="flex gap-2.5 overflow-x-auto px-4 pb-4 pt-0">
            {content.photos.map((photo, index) => (
              <button
                key={`${photo.url}-${index}`}
                type="button"
                onClick={() => setSheet({ kind: 'photos' })}
                className="relative h-[126px] w-[104px] flex-none overflow-hidden rounded-[13px] bg-muted"
              >
                <img src={photo.url} alt={photo.label ?? ''} className="h-full w-full object-cover" />
                {photo.is_cover && (
                  <span
                    className="absolute left-[7px] top-[7px] rounded-md px-[7px] py-0.5 text-[9px] font-bold tracking-[0.04em] text-white"
                    style={{ background: M.ink }}
                  >
                    COVER
                  </span>
                )}
                {photo.label && (
                  <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[rgba(30,24,20,.55)] to-transparent px-[9px] py-2 text-left text-[10px] font-semibold text-white">
                    {photo.label}
                  </span>
                )}
              </button>
            ))}
            {!locked && (
              <button
                type="button"
                onClick={() => setSheet({ kind: 'photos' })}
                className="flex h-[126px] w-[104px] flex-none flex-col items-center justify-center gap-1.5 rounded-[13px] text-primary"
                style={{ border: `1.5px dashed ${M.dashed}`, background: M.dashedBg }}
              >
                <ImagePlus className="h-5 w-5" strokeWidth={1.8} />
                <span className="font-display text-[11px] font-bold">Add</span>
              </button>
            )}
          </div>
        </Card>

        {/* ── Beds & pricing ───────────────────────────────────────────── */}
        <Card>
          <CardHeader
            title="Beds & pricing"
            subtitle="sharing types tenants can request"
            action={
              !locked && (
                <AddButton
                  onClick={() => {
                    patch({ beds: [...content.beds, NEW_BED] });
                    setSheet({ kind: 'bed', index: content.beds.length });
                  }}
                />
              )
            }
          />
          {content.beds.length === 0 && (
            <Empty>No bed types yet. Tenants can't request a bed you haven't listed.</Empty>
          )}
          {content.beds.map((bed, index) => (
            <Row key={index} onClick={locked ? undefined : () => setSheet({ kind: 'bed', index })}>
              <RowIcon>
                <BedDouble className="h-[17px] w-[17px]" strokeWidth={1.8} />
              </RowIcon>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-[7px]">
                  <span className="font-display text-[13.5px] font-bold text-foreground">
                    {bed.name || `${bed.sharing}-bed sharing`}
                  </span>
                  <span
                    className="rounded-[5px] px-[7px] py-0.5 text-[9.5px] font-bold"
                    style={
                      bed.availability === 'FULL'
                        ? { background: M.lockedBg, color: M.lockedText }
                        : { background: M.greenBg, color: M.greenText }
                    }
                  >
                    {bed.availability === 'FULL' ? 'Full' : bed.availability === 'AVAILABLE' ? 'Available' : 'Beds left'}
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {bed.inclusions || `${bed.sharing} beds per room`}
                </p>
              </div>
              <div className="flex-none text-right">
                <p className="font-display text-[14px] font-extrabold tabular-nums text-foreground">
                  ₹{bed.price.toLocaleString('en-IN')}
                </p>
                <p className="text-[10px]" style={{ color: M.faint }}>
                  /month
                </p>
              </div>
              {!locked && <ChevronRight className="h-4 w-4 flex-none" style={{ color: M.chevron }} />}
            </Row>
          ))}
        </Card>

        {/* ── Mess menu ────────────────────────────────────────────────── */}
        <Card>
          <CardHeader
            title="Mess menu"
            subtitle="weekly food shown on Discovery"
            action={
              <button
                type="button"
                role="switch"
                aria-checked={content.mess.provided}
                aria-label="Meals provided"
                disabled={locked}
                onClick={() => patch({ mess: { ...content.mess, provided: !content.mess.provided } })}
                className="relative h-[26px] w-[46px] flex-none rounded-full transition-colors disabled:opacity-60"
                style={{ background: content.mess.provided ? 'var(--primary)' : M.lockedTile }}
              >
                <span
                  className="absolute top-[3px] h-5 w-5 rounded-full bg-white transition-all"
                  style={{ left: content.mess.provided ? 23 : 3 }}
                />
              </button>
            }
          />

          {content.mess.provided ? (
            <>
              <div className="flex flex-wrap gap-[7px] px-4 pb-[13px]">
                {MESS_TYPES.map((type) => {
                  const active = content.mess.type === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      aria-pressed={active}
                      disabled={locked}
                      onClick={() => patch({ mess: { ...content.mess, type } })}
                      className="rounded-[9px] px-3 py-[7px] font-display text-[12px]"
                      style={
                        active
                          ? { background: M.ink, color: '#FFFFFF', fontWeight: 700, border: '1px solid transparent' }
                          : { background: '#FFFFFF', color: M.chipText, fontWeight: 600, border: `1px solid ${M.inputLine}` }
                      }
                    >
                      {MESS_TYPE_LABELS[type]}
                    </button>
                  );
                })}
              </div>

              {content.mess.meals.map((meal, index) => {
                const Icon = MEAL_ICON[meal.key];
                return (
                  <Row
                    key={meal.key}
                    onClick={
                      locked
                        ? undefined
                        : () =>
                            patch({
                              mess: {
                                ...content.mess,
                                meals: content.mess.meals.map((entry, i) =>
                                  i === index ? { ...entry, enabled: !entry.enabled } : entry,
                                ),
                              },
                            })
                    }
                  >
                    <RowIcon>
                      <Icon className="h-4 w-4" strokeWidth={1.8} />
                    </RowIcon>
                    <div className="min-w-0 flex-1">
                      <p
                        className="font-display text-[13px] font-bold"
                        style={{ color: meal.enabled ? 'var(--foreground)' : M.ghost }}
                      >
                        {meal.label}
                      </p>
                      <p className="mt-px text-[11px]" style={{ color: M.faint }}>
                        {meal.time}
                      </p>
                    </div>
                    <span
                      className="flex-none rounded-md px-[9px] py-1 text-[9.5px] font-bold uppercase tracking-[0.04em]"
                      style={
                        meal.enabled
                          ? { background: M.greenBg, color: M.greenText }
                          : { background: M.lockedBg, color: M.ghost }
                      }
                    >
                      {meal.enabled ? 'Served' : 'Off'}
                    </span>
                  </Row>
                );
              })}

              <div className="px-4 pb-[15px] pt-[13px]" style={{ borderTop: `1px solid ${M.rowLine}` }}>
                <div className="mb-[11px] flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-[0.06em]" style={{ color: M.faint }}>
                    This week
                  </span>
                  {!locked && (
                    <button
                      type="button"
                      onClick={() => setSheet({ kind: 'mess' })}
                      className="font-display text-[12px] font-bold text-primary"
                    >
                      Edit weekly menu
                    </button>
                  )}
                </div>

                <div className="mb-3 flex gap-1.5 overflow-x-auto pb-0.5">
                  {MESS_DAY_LABELS.map((label, index) => {
                    const active = index === messDay;
                    return (
                      <button
                        key={label}
                        type="button"
                        aria-pressed={active}
                        onClick={() => setMessDay(index)}
                        className="flex-none rounded-[9px] px-3 py-[7px] font-display text-[12px]"
                        style={{
                          background: active ? 'var(--primary)' : M.chipBg,
                          color: active ? '#FFFFFF' : M.chipText,
                          fontWeight: active ? 700 : 600,
                        }}
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>

                <div
                  className="overflow-hidden rounded-[13px]"
                  style={{ background: M.dashedBg, border: '1px solid #F0E7DB' }}
                >
                  {content.mess.meals.filter((meal) => meal.enabled).length === 0 && (
                    <p className="px-[13px] py-3 text-[12px]" style={{ color: M.ghost }}>
                      Every meal is switched off.
                    </p>
                  )}
                  {content.mess.meals
                    .filter((meal) => meal.enabled)
                    .map((meal, index) => {
                      const Icon = MEAL_ICON[meal.key];
                      const dishes = content.mess.week[messDay]?.[meal.key]?.trim();
                      return (
                        <div
                          key={meal.key}
                          className="flex gap-[11px] px-[13px] py-[11px]"
                          style={{ borderTop: index === 0 ? 'none' : `1px solid ${M.rowLine}` }}
                        >
                          <span className="flex w-[26px] flex-none justify-center pt-px" style={{ color: M.ghost }}>
                            <Icon className="h-[15px] w-[15px]" strokeWidth={1.8} />
                          </span>
                          <div className="min-w-0 flex-1">
                            <p
                              className="text-[10px] font-bold uppercase tracking-[0.05em]"
                              style={{ color: M.ghost }}
                            >
                              {meal.label}
                            </p>
                            <p
                              className="mt-0.5 text-[12.5px] font-medium leading-[1.45]"
                              style={{ color: dishes ? M.outlineText : M.ghost }}
                            >
                              {dishes || 'Not written yet'}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </>
          ) : (
            <p className="px-4 pb-4 pt-0.5 text-[12px] leading-[1.5]" style={{ color: M.faint }}>
              Mess is off. Tenants will see “Meals not provided” on your listing.
            </p>
          )}
        </Card>

        {/* ── Basics ───────────────────────────────────────────────────── */}
        <Card>
          <div className="px-4 pb-1 pt-4 font-display text-[14px] font-bold text-foreground">Basics</div>
          <Row onClick={locked ? undefined : () => setSheet({ kind: 'basics', field: 'tagline' })}>
            <div className="min-w-0 flex-1">
              <p className="text-[11px]" style={{ color: M.faint }}>
                Tagline
              </p>
              <p
                className="mt-0.5 truncate text-[13.5px] font-semibold"
                style={{ color: content.basics.tagline ? 'var(--foreground)' : M.ghost }}
              >
                {content.basics.tagline || 'Not set — one line under your name in search'}
              </p>
            </div>
            {!locked && <ChevronRight className="h-4 w-4 flex-none" style={{ color: M.chevron }} />}
          </Row>
          <Row onClick={locked ? undefined : () => setSheet({ kind: 'basics', field: 'about' })}>
            <div className="min-w-0 flex-1">
              <p className="text-[11px]" style={{ color: M.faint }}>
                About
              </p>
              <p
                className="mt-0.5 truncate text-[13.5px] font-semibold"
                style={{ color: content.basics.about ? 'var(--foreground)' : M.ghost }}
              >
                {content.basics.about || 'Not set — a short paragraph about the place'}
              </p>
            </div>
            {!locked && <ChevronRight className="h-4 w-4 flex-none" style={{ color: M.chevron }} />}
          </Row>
        </Card>

        {/* ── Amenities ────────────────────────────────────────────────── */}
        <Card padded>
          <div className="mb-1 flex items-baseline justify-between">
            <h3 className="font-display text-[14px] font-bold text-foreground">What this hostel offers</h3>
            <span className="text-[11.5px] text-muted-foreground">
              {content.amenities.filter((amenity) => amenity.enabled).length} on
            </span>
          </div>
          <p className="mb-[13px] text-[11px]" style={{ color: M.faint }}>
            Tap to show or hide on the listing
          </p>
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
                      amenities: content.amenities.map((entry, i) =>
                        i === index ? { ...entry, enabled: !entry.enabled } : entry,
                      ),
                    })
                  }
                  className="flex items-center gap-[7px] rounded-[10px] px-[11px] py-2 text-[12px] font-semibold"
                  style={
                    amenity.enabled
                      ? { background: M.iconTile, border: '1px solid transparent', color: '#4A433C' }
                      : { background: '#FFFFFF', border: `1px solid ${M.inputLine}`, color: M.ghost }
                  }
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
                  {amenity.label}
                </button>
              );
            })}
            {!locked && (
              <button
                type="button"
                onClick={() => setSheet({ kind: 'amenity' })}
                className="flex items-center gap-1.5 rounded-[10px] bg-card px-[11px] py-2 font-display text-[12px] font-bold text-primary"
                style={{ border: `1px dashed ${M.dashedClay}` }}
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
                Add amenity
              </button>
            )}
          </div>
        </Card>

        {/* ── Getting around ───────────────────────────────────────────── */}
        <Card>
          <CardHeader
            title="Getting around"
            subtitle="nearby places"
            action={
              !locked && (
                <AddButton
                  onClick={() => {
                    const place: MarketingPlace = {
                      name: '',
                      distance: '',
                      category: 'OTHER',
                      sort: content.places.length,
                    };
                    patch({ places: [...content.places, place] });
                    setSheet({ kind: 'place', index: content.places.length });
                  }}
                />
              )
            }
          />
          {content.places.length === 0 && (
            <Empty>Add a college, metro or market so tenants can place you.</Empty>
          )}
          {content.places.map((place, index) => {
            const Icon = placeIcon(place.category);
            return (
              <Row key={index} onClick={locked ? undefined : () => setSheet({ kind: 'place', index })}>
                <GripVertical className="h-4 w-4 flex-none" style={{ color: '#C6B8A8' }} />
                <RowIcon>
                  <Icon className="h-4 w-4" strokeWidth={1.8} />
                </RowIcon>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold text-foreground">
                    {place.name || 'Unnamed place'}
                  </p>
                  <p className="text-[11px] capitalize" style={{ color: M.faint }}>
                    {place.category.toLowerCase()}
                  </p>
                </div>
                <span className="flex-none font-display text-[12.5px] font-bold tabular-nums" style={{ color: M.chipText }}>
                  {place.distance || '—'}
                </span>
                {!locked && <ChevronRight className="h-4 w-4 flex-none" style={{ color: M.chevron }} />}
              </Row>
            );
          })}
        </Card>

        {/* ── Reviews: locked by design ────────────────────────────────── */}
        <section
          className="flex flex-col gap-[11px] rounded-[18px] px-4 py-[15px]"
          style={{ background: M.lockedBg, border: `1px solid ${M.lockedBorder}` }}
        >
          <div className="flex items-center gap-2.5">
            <span
              className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px]"
              style={{ background: M.lockedTile, color: M.lockedText }}
            >
              <Lock className="h-4 w-4" strokeWidth={1.9} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-[7px]">
                <p className="font-display text-[13.5px] font-bold" style={{ color: M.lockedText }}>
                  Resident reviews
                </p>
                <span
                  className="rounded-[5px] px-[7px] py-0.5 text-[9px] font-bold uppercase tracking-[0.05em]"
                  style={{ background: M.lockedTile, color: '#8A7F75' }}
                >
                  Managed by Stayo
                </span>
              </div>
              {/* The design shows "★ 4.8 · 126 resident reviews". None are
                  collected yet, so the line says that instead. */}
              <p className="mt-[3px] flex items-center gap-1 text-[12px] font-semibold text-muted-foreground">
                <Star className="h-3 w-3" strokeWidth={2} /> No reviews yet
              </p>
            </div>
          </div>
          <p className="text-[11.5px] leading-[1.6] text-muted-foreground">
            Residents review your hostel through Stayo. To keep them trustworthy, owners can't add, edit or remove
            reviews. Spotted something unfair?
          </p>
          <a
            href="mailto:support@yourstayo.com?subject=Report%20a%20review"
            className="self-start font-display text-[12px] font-bold text-primary"
          >
            Report a review to Stayo →
          </a>
        </section>
      </div>

      {/* ── Save bar ───────────────────────────────────────────────────── */}
      {!locked && (
        <div className="fixed inset-x-0 bottom-0 z-30 flex gap-2.5 px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 bg-gradient-to-t from-background from-[22%] to-transparent">
          <button
            type="button"
            onClick={() => setSheet({ kind: 'preview' })}
            className="flex-none rounded-[13px] border-[1.5px] bg-card px-4 py-3.5 font-display text-[13px] font-bold"
            style={{ borderColor: M.outline, color: M.outlineText }}
          >
            Preview
          </button>
          <button
            type="button"
            onClick={() => onSave({ thenSubmit: true })}
            disabled={issues.length > 0 || save.isPending || submit.isPending}
            title={issues[0]}
            className="flex-1 rounded-[13px] bg-primary py-3.5 font-display text-[13.5px] font-bold text-primary-foreground disabled:opacity-50"
            style={{ boxShadow: '0 8px 20px rgba(180,106,85,.3)' }}
          >
            {issues.length > 0
              ? issues[0]
              : save.isPending || submit.isPending
                ? 'Sending…'
                : 'Save & send for review'}
          </button>
        </div>
      )}

      {/* ── Sheets ─────────────────────────────────────────────────────── */}
      <TemplateSheet
        open={sheet.kind === 'template'}
        hostelName={data?.hostel.name ?? 'This hostel'}
        onClose={closeSheet}
      />

      <BasicsSheet
        open={sheet.kind === 'basics'}
        basics={content.basics}
        focusField={sheet.kind === 'basics' ? sheet.field : 'tagline'}
        onClose={closeSheet}
        onSave={(basics) => {
          patch({ basics });
          closeSheet();
        }}
      />

      <AmenitySheet
        open={sheet.kind === 'amenity'}
        existing={content.amenities.map((amenity) => amenity.label)}
        onClose={closeSheet}
        onAdd={(labels) =>
          patch({
            amenities: [
              ...content.amenities,
              ...labels.map((label) => ({ label, enabled: true, icon: null })),
            ],
          })
        }
      />

      <BedSheet
        open={sheet.kind === 'bed'}
        bed={sheet.kind === 'bed' ? (content.beds[sheet.index] ?? null) : null}
        onClose={closeSheet}
        onSave={(next) => {
          if (sheet.kind !== 'bed') return;
          patch({ beds: content.beds.map((bed, i) => (i === sheet.index ? next : bed)) });
          closeSheet();
        }}
        onRemove={() => {
          if (sheet.kind !== 'bed') return;
          patch({ beds: content.beds.filter((_bed, i) => i !== sheet.index) });
          closeSheet();
        }}
      />

      <PlaceSheet
        open={sheet.kind === 'place'}
        place={sheet.kind === 'place' ? (content.places[sheet.index] ?? null) : null}
        onClose={closeSheet}
        onSave={(next) => {
          if (sheet.kind !== 'place') return;
          patch({ places: content.places.map((place, i) => (i === sheet.index ? next : place)) });
          closeSheet();
        }}
        onRemove={() => {
          if (sheet.kind !== 'place') return;
          patch({
            places: content.places
              .filter((_place, i) => i !== sheet.index)
              .map((place, i) => ({ ...place, sort: i })),
          });
          closeSheet();
        }}
      />

      <MessMenuSheet
        open={sheet.kind === 'mess'}
        hostelId={hostelId}
        mess={content.mess}
        initialDay={messDay}
        onClose={closeSheet}
        onSave={(week) => {
          patch({ mess: { ...content.mess, week } });
          closeSheet();
        }}
      />

      <PhotosScreen
        open={sheet.kind === 'photos'}
        hostelId={hostelId}
        photos={content.photos}
        onChange={(photos) => patch({ photos })}
        onClose={closeSheet}
      />

      <PreviewScreen
        open={sheet.kind === 'preview'}
        content={content}
        hostelName={data?.hostel.name ?? 'This hostel'}
        location={null}
        onClose={closeSheet}
      />
    </>
  );
}

/* ── small building blocks ─────────────────────────────────────────────── */

function Card({ children, padded }: { children: React.ReactNode; padded?: boolean }) {
  return (
    <section
      className={`overflow-hidden rounded-[18px] bg-card ${padded ? 'px-4 py-[15px]' : ''}`}
      style={{ border: '1px solid var(--border)', boxShadow: CARD_SHADOW }}
    >
      {children}
    </section>
  );
}

function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex items-center justify-between gap-3 px-4 pb-3 pt-[15px]">
      <div className="flex min-w-0 items-baseline gap-2">
        <h3 className="flex-none font-display text-[14px] font-bold text-foreground">{title}</h3>
        {subtitle && <span className="truncate text-[11.5px] text-muted-foreground">{subtitle}</span>}
      </div>
      {action}
    </header>
  );
}

/** A tappable row inside a card, with the design's hairline above it. */
function Row({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  const className = 'flex w-full items-center gap-3 px-4 py-3 text-left';
  const style = { borderTop: `1px solid ${M.rowLine}` };

  if (!onClick) {
    return (
      <div className={className} style={style}>
        {children}
      </div>
    );
  }
  return (
    <button type="button" onClick={onClick} className={className} style={style}>
      {children}
    </button>
  );
}

function RowIcon({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px]"
      style={{ background: M.iconTile, color: 'var(--primary)' }}
    >
      {children}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="mx-4 mb-4 rounded-xl bg-muted px-3.5 py-3 text-[12px] text-muted-foreground">{children}</p>
  );
}

function AddButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-none items-center gap-1 rounded-[9px] px-[11px] py-[7px] font-display text-[11.5px] font-bold text-white"
      style={{ background: M.ink }}
    >
      <Plus className="h-3 w-3" strokeWidth={2.5} /> Add
    </button>
  );
}
