import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { ChevronLeft, Megaphone, Wrench, Bell } from 'lucide-react';
import { useTenantNotifications, type TenantNotification } from '@features/notifications/hooks/useTenantNotifications';

const card = 'rounded-[16px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_4px_14px_rgba(40,30,20,0.05)]';

function LoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3 px-4 pt-6 sm:px-6">
      <div className="h-16 animate-pulse rounded-2xl bg-muted" />
      <div className="h-16 animate-pulse rounded-2xl bg-muted" />
      <div className="h-16 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

function iconFor(type: string) {
  if (type === 'announcement') return Megaphone;
  if (type === 'service_request') return Wrench;
  return Bell;
}

/**
 * Tenant notifications feed — replaces the bell's previous static "No new
 * alerts" toast with the real `notifications` table, written to by the
 * backend when an owner updates a service-request ticket or posts an
 * announcement. Full-screen takeover, same chrome as `TenantComplaintsPage`.
 */
export function TenantNotificationsPage() {
  const navigate = useNavigate();
  const { isLoading, notifications, markAsRead } = useTenantNotifications();

  const handleOpen = (n: TenantNotification) => {
    if (!n.is_read) markAsRead(n.id);
    if (n.type === 'service_request' && n.metadata?.requestId) {
      navigate('/tenant/complaints', { state: { openTicketId: n.metadata.requestId } });
    } else if (n.type === 'announcement') {
      navigate('/tenant/home');
    }
  };

  return (
    <div className="min-h-screen bg-background pb-10">
      <div className="flex items-center gap-3 px-[22px] pb-4 pt-6">
        <button
          type="button"
          aria-label="Back"
          onClick={() => navigate('/tenant/home')}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-full border border-border"
        >
          <ChevronLeft className="h-[18px] w-[18px]" />
        </button>
        <h1 className="font-display text-[24px] font-extrabold tracking-[-0.03em] text-foreground">Notifications</h1>
      </div>

      {isLoading ? (
        <LoadingSkeleton />
      ) : notifications.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Bell className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <p className="max-w-[220px] text-[12.5px] text-muted-foreground">You&rsquo;re all caught up — nothing new right now.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5 px-4 sm:px-6">
          {notifications.map((n) => {
            const Icon = iconFor(n.type);
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => handleOpen(n)}
                className={`${card} flex w-full items-start gap-3 p-4 text-left`}
              >
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px] bg-[#F5E9E3] text-primary">
                  <Icon className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13.5px] font-semibold text-foreground">{n.title}</span>
                    {!n.is_read && <span className="h-[7px] w-[7px] flex-none rounded-full bg-primary" />}
                  </div>
                  <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">{n.message}</p>
                  <div className="mt-1.5 text-[10.5px] font-medium text-muted-foreground/80">
                    {formatDistanceToNow(new Date(n.created_at), { addSuffix: true })}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
