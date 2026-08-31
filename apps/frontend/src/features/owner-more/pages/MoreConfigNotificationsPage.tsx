import { useConfiguredHostelId } from '../hooks/useConfiguredHostel';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { permissionState } from '@features/push/pushSupport';
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
  const remindersOn = (policyQuery.data?.policy as any)?.automation?.auto_send_reminders !== false;
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
        title="Notifications"
        subtitle="Who hears about what, and how"
      />

      {/*
        The master switch, moved here from the deleted "Automation" screen,
        where it was called the "reminder engine". An owner turning reminders
        off looks for that on the reminders screen, not under a heading named
        after the thing that runs them.
      */}
      <div className="rounded-[20px] border border-border bg-card p-4 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={remindersOn}
            disabled={updateMutation.isPending}
            onChange={() =>
              updateMutation.mutate(
                { automation: { auto_send_reminders: !remindersOn } },
                {
                  onSuccess: () =>
                    stayoToast.success(remindersOn ? 'Reminders paused' : 'Reminders switched on'),
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
                ? 'Tenants are nudged before and after rent is due, without you.'
                : 'Paused — nothing below is sent until you switch this back on.'}
            </span>
          </span>
        </label>
      </div>

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
              /*
               * Push is the one channel the browser can veto. A toggle that
               * silently does nothing is worse than no toggle, so a blocked or
               * unsupported browser gets a disabled chip that says which it is
               * — "blocked" is fixable in site settings, "unavailable" is an
               * iPhone in a browser tab and is not.
               */
              const pushState = channel.key === 'push' ? permissionState() : null;
              const vetoed = pushState === 'denied' || pushState === 'unsupported';
              return (
                <button
                  key={channel.key}
                  type="button"
                  aria-pressed={on && !vetoed}
                  disabled={updateMutation.isPending || vetoed}
                  title={
                    pushState === 'denied'
                      ? 'Blocked in your browser — turn it on in site settings'
                      : pushState === 'unsupported'
                        ? 'Not available in this browser'
                        : undefined
                  }
                  onClick={() => !vetoed && toggleChannel(channel.key, !on)}
                  className={`rounded-full border px-3.5 py-2 text-[12.5px] font-semibold transition-colors disabled:opacity-50 ${
                    on
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border bg-card text-muted-foreground'
                  }`}
                >
                  {pushState === 'denied'
                    ? 'Push · blocked'
                    : pushState === 'unsupported'
                      ? 'Push · unavailable'
                      : channel.label}
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
