import { useState } from 'react';
import { Check } from 'lucide-react';
import {
  AVAILABILITY_OPTIONS,
  SLOT_COUNTS,
  needsSlots,
  needsValue,
  normaliseAvailability,
  placeholderFor,
  type AmenityAvailability,
  type AmenityAvailabilityKind,
  type TimeSlot,
} from '@shared/lib/amenityAvailability';
import { ClockDial } from '@shared/ui-patterns/ClockDial';
import { formatTime } from '@shared/lib/clockDial';

/**
 * "When is this available?", asked once, about one amenity.
 *
 * The screen this replaced put two text inputs beside every enabled amenity —
 * sixteen boxes for eight amenities, with one generic placeholder for all of
 * them. Most had no answer worth typing, because the chip already says what the
 * amenity is.
 *
 * Here the owner picks the *kind* of answer first, and a text field appears
 * only for the kinds that need one. Picking "Nothing extra" is one tap and no
 * typing, which is the right cost for the commonest case.
 */
export function AvailabilitySheet({
  label,
  value,
  onCancel,
  onSave,
}: {
  label: string;
  value: AmenityAvailability;
  onCancel: () => void;
  onSave: (next: AmenityAvailability) => void;
}) {
  const [kind, setKind] = useState<AmenityAvailabilityKind | 'NONE'>(value.availability ?? 'NONE');
  const [text, setText] = useState(value.availabilityValue ?? '');
  const [slots, setSlots] = useState<TimeSlot[]>(
    value.availabilitySlots?.length ? value.availabilitySlots : [{ start: '07:00', end: '09:00' }],
  );
  /** Which block's dial is open. Null means the list of blocks. */
  const [editing, setEditing] = useState<{ index: number; edge: 'start' | 'end' } | null>(null);

  const activeKind = kind === 'NONE' ? null : kind;
  const showField = needsValue(activeKind);
  const showSlots = needsSlots(activeKind);

  /** How many times a day it runs — asked before any clock appears. */
  const setCount = (count: number) => {
    setSlots((current) => {
      if (count <= current.length) return current.slice(0, count);
      const added = Array.from({ length: count - current.length }, () => ({ start: '', end: '' }));
      return [...current, ...added];
    });
    setEditing(null);
  };

  const setEdge = (index: number, edge: 'start' | 'end', next: string) =>
    setSlots((current) => current.map((slot, i) => (i === index ? { ...slot, [edge]: next } : slot)));

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center sm:items-center"
      style={{ background: 'rgba(20,16,13,.5)' }}
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Availability for ${label}`}
        onClick={(event) => event.stopPropagation()}
        className="w-full max-w-[440px] rounded-t-[22px] bg-white sm:rounded-[22px]"
        style={{ padding: '18px 18px calc(18px + env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto mb-3.5 h-1 w-9 rounded-full bg-[#E0D5C6] sm:hidden" />

        <h2 className="font-display text-[17px] font-extrabold tracking-tight text-[#221E1A]">{label}</h2>
        <p className="mt-0.5 text-[12px] text-[#8A7F75]">What should a tenant know about when this is available?</p>

        <div className="mt-3.5 flex flex-col gap-2">
          {AVAILABILITY_OPTIONS.map((option) => {
            const selected = kind === option.kind;
            return (
              <button
                key={option.kind}
                type="button"
                onClick={() => setKind(option.kind)}
                aria-pressed={selected}
                className="flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-left"
                style={{
                  background: selected ? 'rgba(180,106,85,.08)' : '#F7F3EF',
                  border: `1.5px solid ${selected ? '#B46A55' : 'transparent'}`,
                }}
              >
                <span
                  className="mt-px flex h-[18px] w-[18px] flex-none items-center justify-center rounded-full"
                  style={{
                    background: selected ? '#B46A55' : '#FFFFFF',
                    border: `1.5px solid ${selected ? '#B46A55' : '#D9CDBC'}`,
                  }}
                >
                  {selected && <Check className="h-3 w-3 text-white" strokeWidth={3.2} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold text-[#221E1A]">{option.label}</span>
                  <span className="mt-0.5 block text-[11.5px] leading-snug text-[#8A7F75]">{option.hint}</span>
                </span>
              </button>
            );
          })}
        </div>

        {/*
          Hours: how many times a day first, then the clock for each block.
          Asking "how many" up front means the owner is never staring at one
          empty range wondering how to say "three meals".
        */}
        {showSlots && !editing && (
          <div className="mt-3.5">
            <div className="text-[11.5px] font-bold uppercase tracking-[.06em] text-[#8A7F75]">
              How many times a day?
            </div>
            <div className="mt-1.5 flex gap-1.5">
              {SLOT_COUNTS.map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => setCount(count)}
                  aria-pressed={slots.length === count}
                  className="h-9 flex-1 rounded-xl text-[13px] font-bold"
                  style={{
                    background: slots.length === count ? '#B46A55' : '#F3EEE7',
                    color: slots.length === count ? '#FFFFFF' : '#5A5147',
                  }}
                >
                  {count}
                </button>
              ))}
            </div>

            <div className="mt-2.5 flex flex-col gap-1.5">
              {slots.map((slot, index) => (
                <div key={index} className="flex items-center gap-1.5">
                  <span className="w-[54px] flex-none text-[11.5px] font-semibold text-[#8A7F75]">
                    {slots.length === 1 ? 'Time' : `Block ${index + 1}`}
                  </span>
                  {(['start', 'end'] as const).map((edge) => (
                    <button
                      key={edge}
                      type="button"
                      onClick={() => setEditing({ index, edge })}
                      className="flex-1 rounded-xl px-3 py-2.5 text-[13px] font-semibold"
                      style={{
                        background: '#F7F3EF',
                        border: `1px solid ${slot[edge] ? '#E7DDD1' : '#EFE6DA'}`,
                        color: slot[edge] ? '#221E1A' : '#B0A597',
                      }}
                    >
                      {slot[edge] ? formatTime(slot[edge]) : edge === 'start' ? 'From' : 'To'}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        )}

        {showSlots && editing && (
          <div className="mt-3.5">
            <ClockDial
              label={`${editing.edge === 'start' ? 'Starts at' : 'Ends at'}${slots.length > 1 ? ` · block ${editing.index + 1}` : ''}`}
              value={slots[editing.index]?.[editing.edge] || (editing.edge === 'start' ? '07:00' : '09:00')}
              onChange={(next) => setEdge(editing.index, editing.edge, next)}
            />
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="mt-2 w-full rounded-xl py-2.5 text-[13px] font-bold"
              style={{ background: '#F3EEE7', color: '#221E1A' }}
            >
              Done
            </button>
          </div>
        )}

        {/* Only for the kinds that need words, with a placeholder that fits. */}
        {showField && (
          <div className="mt-3">
            {activeKind === 'NOTE' ? (
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={2}
                maxLength={120}
                placeholder={placeholderFor(activeKind)}
                className="w-full resize-none rounded-xl border border-[#E7DDD1] bg-white px-3 py-2.5 text-[13px] text-[#2A2521]"
              />
            ) : (
              <input
                value={text}
                onChange={(event) => setText(event.target.value)}
                maxLength={120}
                placeholder={placeholderFor(activeKind)}
                className="w-full rounded-xl border border-[#E7DDD1] bg-white px-3 py-2.5 text-[13px] text-[#2A2521]"
              />
            )}
          </div>
        )}

        <div className="mt-3.5 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-xl border border-[#E7DDD1] px-4 py-3 text-[13.5px] font-bold text-[#221E1A]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() =>
              onSave(
                normaliseAvailability({ availability: activeKind, availabilityValue: text, availabilitySlots: slots }),
              )
            }
            className="flex-1 rounded-xl py-3 text-[13.5px] font-bold text-white"
            style={{ background: '#B46A55' }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
