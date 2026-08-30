import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationService } from '@features/notifications/api';
import { useTenantSession } from '@features/tenant-session/useTenantSession';

export interface TenantNotification {
  id: string;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
  metadata: { requestId?: string } | null;
}

/** Tenant's real notification feed — service-request ticket updates and owner announcements, both written server-side into the shared `notifications` table. */
export function useTenantNotifications() {
  const session = useTenantSession();
  const queryClient = useQueryClient();

  const notificationsQuery = useQuery<TenantNotification[]>({
    queryKey: ['tenant', 'notifications'],
    queryFn: () => notificationService.getAll(),
    enabled: session.isAuthenticated,
    staleTime: 15_000,
  });

  const markAsReadMutation = useMutation({
    mutationFn: (id: string) => notificationService.markAsRead(id),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ['tenant', 'notifications'] });
      const previous = queryClient.getQueryData<TenantNotification[]>(['tenant', 'notifications']);
      queryClient.setQueryData<TenantNotification[]>(['tenant', 'notifications'], (old) =>
        (old ?? []).map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(['tenant', 'notifications'], context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant', 'notifications'] });
    },
  });

  const notifications = notificationsQuery.data ?? [];

  return {
    isLoading: notificationsQuery.isLoading,
    notifications,
    hasUnread: notifications.some((n) => !n.is_read),
    markAsRead: markAsReadMutation.mutate,
  };
}
