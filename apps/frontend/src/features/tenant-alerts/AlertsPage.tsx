import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, ChevronLeft, Home, MessageSquare, Utensils, Wallet } from 'lucide-react';
import api from '@lib/api-client';
import { C, FONT, GRID_GROUND } from '@/app/pages/discover/discoverTheme';
import { SCREEN_HEADER_CLASS, SCREEN_HEADER_STYLE, ScreenTitle, SectionHead } from '@features/stayo-ui/ListSection';
import { alertKind, groupAlerts, shortAge, unreadCount, type AlertKind, type AlertRow } from './alerts';

/**
 * Everything the product has ever said to this person, in one place.
 *
 * `notifications` had **26 live rows and no reader**. Ten were `move_out`
 * notices addressed to residents who could never have seen one; the table was
 * written to for months, `GET /api/notifications` existed and was correctly
 * scoped to the session, and the only frontend touching the feature was the
 * *owner's* reminder button. This screen is the missing half.
 */

const ICON: Record<AlertKind, typeof Bell> = {
  MESSAGE: MessageSquare,
  MONEY: Wallet,
  STAY: Home,
  FOOD: Utensils,
  UPDATE: Bell,
};

const TINT: Record<AlertKind, { bg: string; fg: string }> = {
  MESSAGE: { bg: C.clayPaleBg, fg: C.clayDeep },
  MONEY: { bg: '#EAF3EE', fg: C.green },
  STAY: { bg: '#F5E9E3', fg: C.clay },
  FOOD: { bg: '#FBF1DE', fg: C.amber },
  UPDATE: { bg: '#F4EEE7', fg: C.textMuted },
};

export function AlertsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  useEffect(() => {
    document.title = 'Alerts — Stayo';
  }, []);

  const alertsQuery = useQuery({
    queryKey: ['notifications'],
    queryFn: async () => {
      const response = await api.get('/notifications');
      const body = response.data?.data ?? response.data ?? {};
      return (body.notifications ?? body ?? []) as AlertRow[];
    },
  });

  const rows = useMemo(() => alertsQuery.data ?? [], [alertsQuery.data]);
  const groups = useMemo(() => groupAlerts(rows), [rows]);
  const unread = unreadCount(rows);

  const readMutation = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  return (
    <div className="flex min-h-[100dvh] flex-col" style={GRID_GROUND}>
      <header className={SCREEN_HEADER_CLASS} style={SCREEN_HEADER_STYLE}>
        <button
          type="button"
          aria-label="Back to Profile"
          onClick={() => navigate('/profile')}
          className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-full"
          style={{ background: '#F4EEE7' }}
        >
          <ChevronLeft className="h-5 w-5" style={{ color: '#6B6259' }} />
        </button>
        <ScreenTitle>Alerts</ScreenTitle>
        {unread > 0 && (
          <span
            className="ml-auto flex-none rounded-full px-2.5 py-1 text-[11px] font-bold"
            style={{ background: C.clayPaleBg, color: '#A4482F' }}
          >
            {unread} new
          </span>
        )}
      </header>

      <main className="mx-auto w-full max-w-[640px] flex-1 space-y-5 px-5 py-5">
        {alertsQuery.isLoading && <div className="h-24 animate-pulse rounded-2xl bg-white/60" />}

        {!alertsQuery.isLoading && rows.length === 0 && (
          <div
            className="rounded-2xl border bg-white p-8 text-center"
            style={{ borderColor: C.line }}
          >
            <Bell className="mx-auto h-6 w-6" style={{ color: '#C9BFB4' }} />
            <p className="mt-2 text-[13px] font-semibold" style={{ color: C.text }}>
              Nothing yet
            </p>
            <p className="mt-1 text-[12px] leading-[1.5]" style={{ color: C.textMuted }}>
              Rent reminders, messages from your hostel and anything about your stay will
              appear here.
            </p>
          </div>
        )}

        {groups.map((group) => (
          <section key={group.bucket}>
            <SectionHead title={group.bucket} />
            <div
              className="overflow-hidden rounded-2xl border bg-white"
              style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}
            >
              {group.rows.map((row, index) => {
                const kind = alertKind(row.type);
                const Icon = ICON[kind];
                const tint = TINT[kind];
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => !row.is_read && readMutation.mutate(row.id)}
                    className="flex w-full items-start gap-3 px-3.5 py-3.5 text-left"
                    style={{
                      borderTop: index === 0 ? 'none' : `1px solid ${C.lineSoft}`,
                      background: row.is_read ? undefined : 'rgba(180,106,85,.04)',
                    }}
                  >
                    <span
                      className="mt-0.5 flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px]"
                      style={{ background: tint.bg }}
                    >
                      <Icon className="h-[15px] w-[15px]" strokeWidth={1.9} style={{ color: tint.fg }} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2">
                        <span
                          className="min-w-0 flex-1 truncate text-[13.5px]"
                          style={{
                            color: C.inkSoft,
                            fontWeight: row.is_read ? 600 : 800,
                            fontFamily: row.is_read ? undefined : FONT.display,
                          }}
                        >
                          {row.title}
                        </span>
                        <span className="flex-none text-[11px]" style={{ color: C.textGhost }}>
                          {shortAge(row.created_at)}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-[12px] leading-[1.5]" style={{ color: C.textBody }}>
                        {row.message}
                      </span>
                    </span>
                    {/* An unread dot, not a badge — the row is already tinted. */}
                    {!row.is_read && (
                      <span
                        className="mt-2 h-[7px] w-[7px] flex-none rounded-full"
                        style={{ background: C.clay }}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
