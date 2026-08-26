import api from '@lib/api-client';

/**
 * Manual charges against a tenant.
 *
 * `POST /api/payments/obligations` is owner-scoped by session and takes no
 * identity token — unlike obligation cancel and waive, which do. Creating a
 * charge raises a debt and is reversible by cancelling it; forgiving one is
 * not, which is where the password step belongs.
 */
export interface CreateObligationInput {
  tenant_id: string;
  obligation_type: string;
  amount: number;
  due_date: string;
  rent_month: string;
  description?: string;
  notes?: string;
}

export const obligationService = {
  create: async (input: CreateObligationInput) => {
    const response = await api.post('/payments/obligations', input);
    return response.data?.data !== undefined ? response.data.data : response.data;
  },
};
