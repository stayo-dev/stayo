import { useEffect, useState } from 'react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useHostelPolicy, useUpdateHostelPolicy } from '@features/settings/settingsHooks';
import { useConfiguredHostelId } from '../hooks/useConfiguredHostel';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { SaveBar } from '../components/SaveBar';
import { hasChanges } from '../config/dirtyState';
import { NOTIFICATION_CHANNELS, buildChannelPatch } from '../config/notificationChannels';
import {
  fromPolicy,
  toPolicyPatch,
  toggleDay,
  isSelected,
  selectedDays,
  dayLabel,
  describePlan,
  crowdingWarning,
  messagePreview,
  kindForOffset,
  KIND_LABEL,
  MAX_BEFORE,
  MAX_AFTER,
  type ReminderSchedule,
} from '../config/reminderDays';

const card =
  'overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

/** Colour per message kind — the same three the templates send. */
const KIND_TONE: Record<string, { chip: string; dot: string }> = {
  DUE_SOON: { chip: 'bg-[#E6F0E8] text-[#2F5B41] border-[#BFD8C7]', dot: 'bg-[#3F7D58]' },
  DUE_TODAY: { chip: 'bg-primary text-primary-foreground border-primary', dot: 'bg-primary' },
  OVERDUE: { chip: 'bg-[#F7E4DF] text-[#8E3122] border-[#EBC4BA]', dot: 'bg-[#B3402F]' },
};

const BEFORE_OFFSETS = Array.from({ length: MAX_BEFORE }, (_, i) => -(MAX_BEFORE - i));
const AFTER_OFFSETS = Array.from({ length: MAX_AFTER }, (_, i) => i + 1);

/**
 * Reminders.
 *
 * The screen listed "Rent due" and "Late fee applied" as events with a
 * read-only summary underneath — "Sent 1, 5 and 10 days after the due date" —
 * so an owner could see the schedule and not change it, and the one thing
 * this screen exists to control was the one thing it did not offer.
 *
 * Now it is the schedule. The owner picks days; what each reminder *says*
 * follows from where the day sits relative to that tenant's due date, and
 * there is nothing to choose — those are the three approved WhatsApp
 * templates, and letting an owner pick "overdue" for a day before rent is due
 * would promise a message we cannot send.
 *
 * A strip centred on the due day, not a month calendar: the stored values are
 * offsets from *each tenant's own* due date, so a tenant due on the 5th and
 * one due on the 20th share this schedule and are reminded on different
 * calendar days. A 1-31 grid would be a lie for everyone but whoever matched
 * the hostel's default due day.
 */
export function MoreConfigNotificationsPage() {
  const hostelId = useConfiguredHostelId();
  const policyQuery = useHostelPolicy(hostelId);
  const updateMutation = useUpdateHostelPolicy(hostelId ?? '');

  const reminders = policyQuery.data?.policy?.reminders;
  const hostelName = policyQuery.data?.hostel?.name ?? 'your hostel';
  const channels = (reminders?.channels ?? {}) as Record<string, boolean>;
  const remindersOn = (policyQuery.data?.policy as any)?.automation?.auto_send_reminders !== false;

  const [schedule, setSchedule] = useState<ReminderSchedule | null>(null);
  const [baseline, setBaseline] = useState<ReminderSchedule | null>(null);
  const [openPreview, setOpenPreview] = useState<number | null>(null);

  useEffect(() => {
    if (!reminders) return;
    const loaded = fromPolicy(reminders);
    setSchedule(loaded);
    setBaseline(loaded);
  }, [policyQuery.data]);

  const dirty = hasChanges(baseline, schedule);
  const days = schedule ? selectedDays(schedule) : [];
  const warning = schedule ? crowdingWarning(schedule) : null;

  const save = () => {
    if (!hostelId || !schedule) return;
    updateMutation.mutate(toPolicyPatch(schedule), {
      onSuccess: () => {
        setBaseline(schedule);
        stayoToast.success('Reminder days saved');
      },
      onError: () => stayoToast.error('Could not save the reminder days'),
    });
  };

  const toggleChannel = (key: string, next: boolean) => {
    updateMutation.mutate(buildChannelPatch(key as any, next), {
      onSuccess: () => stayoToast.success(next ? 'Channel on' : 'Channel off'),
      onError: () => stayoToast.error('Could not update delivery channels'),
    });
  };

  const DayButton = ({ offset }: { offset: number }) => {
    if (!schedule) return null;
    const on = isSelected(schedule, offset);
    const tone = KIND_TONE[kindForOffset(offset)];
    return (
      <button
        type="button"
        onClick={() => setSchedule(toggleDay(schedule, offset))}
        aria-pressed={on}
        aria-label={dayLabel(offset)}
        className={`h-9 min-w-9 flex-none rounded-lg border px-2 text-[12.5px] font-semibold tabular-nums transition-colors ${
          on ? tone.chip : 'border-border bg-card text-muted-foreground'
        }`}
      >
        {offset === 0 ? 'Due' : Math.abs(offset)}
      </button>
    );
  };

  return (
    <div className={`flex flex-col gap-5 px-4 pt-6 sm:px-6 ${dirty ? 'pb-40' : 'pb-24'}`}>
      <MoreScreenHeader title="Reminders" subtitle="When tenants are nudged about rent" />

      <div className={`${card} p-4`}>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={remindersOn}
            disabled={updateMutation.isPending}
            onChange={() =>
              updateMutation.mutate(
                { automation: { auto_send_reminders: !remindersOn } },
                {
                  onSuccess: () => stayoToast.success(remindersOn ? 'Reminders paused' : 'Reminders switched on'),
                  onError: () => stayoToast.error('Could not change reminders'),
                },
              )
            }
            className="mt-0.5 h-4 w-4 flex-none accent-primary"
          />
          <span className="min-w-0 flex-1">
            <span className="block text-[13.5px] font-semibold text-foreground">Send reminders automatically</span>
            <span className="mt-0.5 block text-[11.5px] leading-[1.45] text-muted-foreground">
              {remindersOn
                ? 'Tenants are nudged on the days you choose below, without you.'
                : 'Paused — nothing below is sent until you switch this back on.'}
            </span>
          </span>
        </label>
      </div>

      {schedule && (
        <section className="flex flex-col gap-2">
          <span className={sectionLabel}>Which days</span>
          <div className={`${card} p-4`}>
            <p className="text-[11.5px] leading-[1.5] text-muted-foreground">
              Counted from each tenant's own due date, so everyone gets the same treatment whichever day
              their rent falls on.
            </p>

            <div className="mt-3.5">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Before rent is due
              </p>
              <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {BEFORE_OFFSETS.map((offset) => (
                  <DayButton key={offset} offset={offset} />
                ))}
              </div>
            </div>

            <div className="mt-3.5">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                On the day
              </p>
              <DayButton offset={0} />
            </div>

            <div className="mt-3.5">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                After it is overdue
              </p>
              <div className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {AFTER_OFFSETS.map((offset) => (
                  <DayButton key={offset} offset={offset} />
                ))}
              </div>
            </div>

            <p className="mt-4 border-t border-border/60 pt-3 text-[12px] font-medium text-foreground">
              {describePlan(schedule)}
            </p>
            {warning && (
              <p className="mt-2 rounded-xl bg-[#F8EFDC] px-3 py-2 text-[11.5px] leading-[1.5] text-[#7A5510]">
                {warning}
              </p>
            )}
          </div>
        </section>
      )}

      {days.length > 0 && (
        <section className="flex flex-col gap-2">
          <span className={sectionLabel}>What each one says</span>
          <div className={card}>
            {days.map((day, i) => {
              const open = openPreview === day.offset;
              return (
                <div key={day.offset} className={i === 0 ? '' : 'border-t border-border/60'}>
                  <button
                    type="button"
                    onClick={() => setOpenPreview(open ? null : day.offset)}
                    className="flex w-full items-center gap-2.5 px-4 py-3 text-left"
                  >
                    <span className={`h-2 w-2 flex-none rounded-full ${KIND_TONE[day.kind].dot}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-semibold text-foreground">{dayLabel(day.offset)}</span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">{KIND_LABEL[day.kind]}</span>
                    </span>
                    <span className="flex-none text-[11px] font-semibold text-primary">
                      {open ? 'Hide' : 'Read'}
                    </span>
                  </button>
                  {open && (
                    /* The approved template body, with this hostel's name in
                       it. An owner has never been shown what Stayo says on
                       their behalf. */
                    <p className="mx-4 mb-3 rounded-xl bg-secondary px-3.5 py-3 text-[12px] leading-[1.6] text-foreground/85">
                      {messagePreview(day.kind, day.offset, hostelName)}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <span className={sectionLabel}>How they are delivered</span>
        <div className={`${card} p-4`}>
          <div className="flex flex-wrap gap-2">
            {NOTIFICATION_CHANNELS.map((channel) => {
              const on = Boolean(channels[channel.key]);
              return (
                <button
                  key={channel.key}
                  type="button"
                  disabled={updateMutation.isPending}
                  onClick={() => toggleChannel(channel.key, !on)}
                  aria-pressed={on}
                  className={`rounded-full border px-3.5 py-2 text-[12.5px] font-semibold ${
                    on ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card text-muted-foreground'
                  }`}
                >
                  {channel.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2.5 text-[11px] leading-[1.5] text-muted-foreground">
            {Object.values(channels).some(Boolean)
              ? 'These carry every reminder above.'
              : 'No channels on — nothing will be delivered.'}
          </p>
        </div>
      </section>

      <SaveBar
        visible={dirty}
        pending={updateMutation.isPending}
        onSave={save}
        onDiscard={() => baseline && setSchedule(baseline)}
        label="Save reminder days"
      />
    </div>
  );
}
