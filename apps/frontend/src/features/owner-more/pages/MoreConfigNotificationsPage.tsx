import { useConfiguredHostelId } from '../hooks/useConfiguredHostel';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useNavigate } from 'react-router-dom';
import { useHostelPolicy, useUpdateHostelPolicy } from '@features/settings/settingsHooks';
import { MoreScreenHeader } from '../components/MoreScreenHeader';
import { ConfigSectionGroup } from '../components/ConfigSectionGroup';
import {
  NOTIFICATION_CHANNELS,
  buildChannelPatch,
  deriveNotificationSections,
  type NotificationChannelKey,
} from '../config/deriveNotificationSections';

/**
 * Configuration › Notifications.
 *
 * **Deliberate improvement on the supplied design.** The design puts channel
 * chips on every event row. Channels are stored **globally** — one set for all
 * reminder traffic — so per-row chips would mean tapping Email on "Rent due"
 * silently changed every other row too.
 *
 * Instead the channels appear **once**, at the top, labelled as applying to
 * everything below, and each event row says which channels will carry it. The
 * design's "set it up by moment" framing is kept; the false promise of
 * per-event control is not.
 */
export function MoreConfigNotificationsPage() {
  const navigate = useNavigate();
  
  const hostelId = useConfiguredHostelId();
  const policyQuery = useHostelPolicy(hostelId);
  const updateMutation = useUpdateHostelPolicy(hostelId ?? '');

  const reminders = policyQuery.data?.policy?.reminders ?? null;
  const channels = reminders?.channels ?? {};
  const sections = deriveNotificationSections({ reminders });

  const activeChannels = NOTIFICATION_CHANNELS.filter(
    (channel) => (channels as Record<string, boolean>)[channel.key],
  );

  const toggleChannel = (channel: NotificationChannelKey, next: boolean) => {
    if (!hostelId) return;
    updateMutation.mutate(buildChannelPatch(channel, next), {
      onSuccess: () => stayoToast.success(`${next ? 'Enabled' : 'Disabled'} ${channel === 'in_app' ? 'in-app' : channel}`),
      onError: () => stayoToast.error('Could not update delivery channels'),
    });
  };

  return (
    <div className="flex flex-col gap-5 px-4 pb-8 pt-6 sm:px-6">
      <MoreScreenHeader
        backTo="/owner/more"
        backLabel="Configuration"
        title="Notifications"
        subtitle="Who hears about what, and how"
      />

      <div className="rounded-[20px] bg-foreground p-5 shadow-[0_12px_30px_rgba(34,30,26,0.24)]">
        <div className="font-display text-[14.5px] font-bold tracking-tight text-background">
          Delivery applies to everything
        </div>
        <div className="mt-1.5 text-[12.5px] leading-relaxed text-background/60">
          These channels carry every notification below. Stayo stores one delivery setting per
          hostel, not one per event — so this is the whole picture, in one place.
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Delivery channels
        </div>
        <div className="rounded-[20px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
          <div className="flex flex-wrap gap-2">
            {NOTIFICATION_CHANNELS.map((channel) => {
              const on = Boolean((channels as Record<string, boolean>)[channel.key]);
              return (
                <button
                  key={channel.key}
                  type="button"
                  aria-pressed={on}
                  disabled={updateMutation.isPending}
                  onClick={() => toggleChannel(channel.key, !on)}
                  className={`rounded-full border px-3.5 py-2 text-[12.5px] font-semibold transition-colors disabled:opacity-50 ${
                    on
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border bg-card text-muted-foreground'
                  }`}
                >
                  {channel.label}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
            {activeChannels.length === 0
              ? 'No channels on — nothing will be delivered.'
              : `Delivered by ${activeChannels.map((c) => c.label).join(' · ')}.`}
            {' '}SMS and push aren&apos;t available yet.
          </p>
        </div>
      </div>

      {sections.map((section) => (
        <ConfigSectionGroup key={section.label} section={section} onNavigate={navigate} />
      ))}
    </div>
  );
}
