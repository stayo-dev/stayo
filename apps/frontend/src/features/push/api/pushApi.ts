import api from '@lib/api-client';

export interface SubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/**
 * The only layer allowed to know these endpoint shapes — `check-architecture`
 * bans raw fetch/axios everywhere else under `features/`.
 */
export const pushApi = {
  subscribe: (body: SubscriptionBody) => api.post('/push/subscriptions', body),
  unsubscribe: (endpoint: string) => api.delete('/push/subscriptions', { data: { endpoint } }),
};
